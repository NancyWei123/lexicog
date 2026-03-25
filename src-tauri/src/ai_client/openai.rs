use super::{OCRClient, TextToSpeechClient, TextToTextResult, ToolCall};
use crate::{
    api::impl_get_vendor_api,
    config::constant::{self, Vendor},
    db::SqliteInterface,
};
use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
use tauri::ipc::Channel;

pub struct OpenAIClient {
    pub api_key: String,
    pub base_url: String,
}

#[derive(Debug, Deserialize)]
struct DeltaEvent {
    delta: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponseCompletedEvent {
    response: Option<ResponseEnvelope>,
}

#[derive(Debug, Deserialize)]
struct ResponseEnvelope {
    output: Option<Vec<ResponseOutputItem>>,
}

#[derive(Debug, Deserialize)]
struct ResponseOutputItem {
    id: Option<String>,
    #[serde(rename = "type")]
    item_type: String,
    call_id: Option<String>,
    name: Option<String>,
    arguments: Option<String>,
    content: Option<Vec<ResponseOutputContent>>,
}

#[derive(Debug, Deserialize)]
struct ResponseOutputContent {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

fn normalize_tools_for_responses(tools: Vec<Value>) -> Vec<Value> {
    tools
        .into_iter()
        .map(|tool| {
            let Some(function) = tool.get("function").and_then(Value::as_object) else {
                return tool;
            };

            let mut normalized = tool.as_object().cloned().unwrap_or_default();
            normalized.remove("function");
            normalized.insert("type".to_string(), Value::String("function".to_string()));

            for field in ["name", "description", "parameters", "strict"] {
                if let Some(value) = function.get(field) {
                    normalized.insert(field.to_string(), value.clone());
                }
            }

            Value::Object(normalized)
        })
        .collect()
}

fn parse_sse_message(sse_message: &str) -> (String, String) {
    let mut event_type = String::new();
    let mut data_lines = Vec::new();

    for line in sse_message.lines() {
        if let Some(evt) = line.strip_prefix("event:") {
            event_type = evt.trim().to_string();
        } else if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start());
        }
    }

    (event_type, data_lines.join("\n").trim().to_string())
}

fn extract_text_from_response_output(output: &[ResponseOutputItem]) -> String {
    output
        .iter()
        .filter(|item| item.item_type == "message")
        .flat_map(|item| item.content.iter().flatten())
        .filter(|content| content.content_type == "output_text")
        .filter_map(|content| content.text.as_deref())
        .collect()
}

fn extract_tool_calls_from_response_output(output: Vec<ResponseOutputItem>) -> Vec<ToolCall> {
    output
        .into_iter()
        .enumerate()
        .filter(|(_, item)| item.item_type == "function_call")
        .filter_map(|(index, item)| {
            let name = item.name?;
            let arguments = item
                .arguments
                .as_deref()
                .and_then(|value| serde_json::from_str(value).ok())
                .unwrap_or(Value::Null);

            Some(ToolCall {
                call_id: item
                    .call_id
                    .or(item.id)
                    .unwrap_or_else(|| format!("openai_call_{}", index)),
                name,
                arguments,
            })
        })
        .collect()
}

fn extract_stream_error_message(data: &str) -> String {
    serde_json::from_str::<Value>(data)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| value.pointer("/message").and_then(Value::as_str))
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| data.to_string())
}

impl OpenAIClient {
    pub async fn new(db: &SqliteInterface) -> Result<Self> {
        let (api_key, base_url) =
            impl_get_vendor_api(db, constant::Vendor::OpenAI.to_string().as_str())
                .await
                .context("initialize OpenAI client: load vendor credentials from database")?
                .ok_or(anyhow!("missing API credentials for vendor OpenAI"))
                .context("initialize OpenAI client: validate stored credentials")?;
        Ok(Self {
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }
}

impl super::TextToTextClient for OpenAIClient {
    fn execute_streaming_text_to_text_task(
        &self,
        channel: Channel<Option<String>>,
        system_prompt: String,
        user_prompt: String,
        output_structure: Option<Value>,
        tools: Option<Vec<Value>>,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<TextToTextResult>> + Send + '_>> {
        let client = reqwest::Client::new();
        let url = self.base_url.to_string() + "/responses";
        let model_id_for_error = model_id.clone();

        let mut body = json!({
            "model": model_id,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": system_prompt }]
                },
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": user_prompt }]
                }
            ],
            "stream": true
        });

        if let Some(schema) = output_structure {
            body["text"] = json!({
                "format": {
                    "type": "json_schema",
                    "name": "language_tool_response",
                    "schema": schema,
                    "strict": true
                }
            });
        }

        if let Some(tools_array) = tools {
            body["tools"] = json!(normalize_tools_for_responses(tools_array));
        }

        let request_builder = client
            .post(&url)
            .json(&body)
            .header("Authorization", format!("Bearer {}", self.api_key));

        Box::pin(async move {
            let response = request_builder.send().await.with_context(|| {
                format!(
                    "OpenAI text-to-text streaming request failed (model: {})",
                    model_id_for_error
                )
            })?;

            let status = response.status();

            if !status.is_success() {
                let error_text = response
                    .text()
                    .await
                    .with_context(|| {
                        format!(
                            "OpenAI text-to-text streaming request failed while reading error body (model: {})",
                            model_id_for_error
                        )
                    })?;
                let body = error_text.trim();
                return Err(if body.is_empty() {
                    anyhow!("HTTP {}", status.as_u16())
                } else {
                    anyhow!("HTTP {} — {}", status.as_u16(), body)
                })
                .with_context(|| {
                    format!(
                        "OpenAI text-to-text streaming API returned non-success status (model: {})",
                        model_id_for_error
                    )
                });
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut result = TextToTextResult::default();
            let mut saw_text_delta = false;
            let mut completed_output: Option<Vec<ResponseOutputItem>> = None;

            let mut stream_active = true;
            while stream_active {
                match stream.next().await {
                    Some(chunk) => {
                        let chunk = chunk.with_context(|| {
                            format!(
                                "OpenAI text-to-text streaming response chunk read failed (model: {})",
                                model_id_for_error
                            )
                        })?;
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                    }
                    None => {
                        stream_active = false;
                        buffer.push_str("\n\n");
                    }
                }

                while let Some(pos) = buffer.find("\n\n") {
                    let sse_message = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();

                    let (event_type, data) = parse_sse_message(&sse_message);

                    if data.is_empty() {
                        continue;
                    }

                    if data == "[DONE]" {
                        stream_active = false;
                        break;
                    }

                    match event_type.as_str() {
                        "response.output_text.delta" => {
                            let delta_event = serde_json::from_str::<DeltaEvent>(&data)
                                .context("parse OpenAI SSE event: response.output_text.delta")?;
                            if let Some(delta) = delta_event.delta {
                                saw_text_delta = true;
                                result.text.push_str(&delta);
                                channel
                                    .send(Some(delta))
                                    .context("forward OpenAI text delta to frontend channel")?;
                            }
                        }
                        "response.completed" | "response.incomplete" => {
                            let completed_event =
                                serde_json::from_str::<ResponseCompletedEvent>(&data)
                                    .with_context(|| {
                                        format!("parse OpenAI SSE event: {}", event_type)
                                    })?;

                            if let Some(output) = completed_event
                                .response
                                .and_then(|response| response.output)
                            {
                                if !saw_text_delta {
                                    let fallback_text = extract_text_from_response_output(&output);
                                    if !fallback_text.is_empty() {
                                        result.text.push_str(&fallback_text);
                                        channel.send(Some(fallback_text)).context(
                                            "forward OpenAI text fallback to frontend channel",
                                        )?;
                                    }
                                }

                                completed_output = Some(output);
                            }
                        }
                        "response.failed" | "error" => {
                            return Err(anyhow!(extract_stream_error_message(&data))).context(
                                "OpenAI text-to-text streaming API emitted a failure event",
                            );
                        }
                        _ => {}
                    }
                }
            }

            if let Some(output) = completed_output {
                result.tool_calls = extract_tool_calls_from_response_output(output);
            }

            channel
                .send(None)
                .context("send OpenAI text streaming completion signal to frontend channel")?;
            Ok(result)
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::OpenAI
    }
}

impl TextToSpeechClient for OpenAIClient {
    fn execute_text_to_speech_task(
        &self,
        prompt: String,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send + '_>> {
        let client = reqwest::Client::new();
        let url = self.base_url.to_string() + "/audio/speech";
        let model_id_for_error = model_id.clone();
        let body = json!({
            "model": model_id,
            "input": prompt,
            "voice": "coral",
            "instructions": "Speak in a professional and clear tone.",
            "response_format": "mp3"
        });

        Box::pin(async move {
            let response = client
                .post(&url)
                .json(&body)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .send()
                .await
                .with_context(|| {
                    format!(
                        "OpenAI text-to-speech request failed (model: {})",
                        model_id_for_error
                    )
                })?;

            let status = response.status();

            if !status.is_success() {
                let error_text = response.text().await.with_context(|| {
                    format!(
                        "OpenAI text-to-speech request failed while reading error body (model: {})",
                        model_id_for_error
                    )
                })?;
                let body = error_text.trim();
                return Err(if body.is_empty() {
                    anyhow!("HTTP {}", status.as_u16())
                } else {
                    anyhow!("HTTP {} — {}", status.as_u16(), body)
                })
                .with_context(|| {
                    format!(
                        "OpenAI text-to-speech API returned non-success status (model: {})",
                        model_id_for_error
                    )
                });
            }

            let audio_bytes = response.bytes().await.with_context(|| {
                format!(
                    "OpenAI text-to-speech response body read failed (model: {})",
                    model_id_for_error
                )
            })?;
            Ok(audio_bytes.to_vec())
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::OpenAI
    }
}

impl OCRClient for OpenAIClient {
    fn execute_ocr_task(
        &self,
        channel: Channel<Option<String>>,
        prompt: String,
        image: String,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + '_>> {
        let client = reqwest::Client::new();
        let url = self.base_url.to_string() + "/responses";
        let model_id_for_error = model_id.clone();

        let body = json!({
            "model": model_id,
            "stream": true,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {
                            "type": "input_image",
                            "image_url": format!("data:image/png;base64,{}", image)
                        }
                    ]
                }
            ]
        });

        let request_builder = client
            .post(&url)
            .json(&body)
            .header("Authorization", format!("Bearer {}", self.api_key));

        Box::pin(async move {
            let response = request_builder.send().await.with_context(|| {
                format!(
                    "OpenAI OCR streaming request failed (model: {})",
                    model_id_for_error
                )
            })?;

            let status = response.status();

            if !status.is_success() {
                let error_text = response.text().await.with_context(|| {
                    format!(
                        "OpenAI OCR streaming request failed while reading error body (model: {})",
                        model_id_for_error
                    )
                })?;
                let body = error_text.trim();
                return Err(if body.is_empty() {
                    anyhow!("HTTP {}", status.as_u16())
                } else {
                    anyhow!("HTTP {} — {}", status.as_u16(), body)
                })
                .with_context(|| {
                    format!(
                        "OpenAI OCR streaming API returned non-success status (model: {})",
                        model_id_for_error
                    )
                });
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut whole_answer = String::new();

            while let Some(chunk) = stream.next().await {
                let chunk = chunk.with_context(|| {
                    format!(
                        "OpenAI OCR streaming response chunk read failed (model: {})",
                        model_id_for_error
                    )
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find("\n\n") {
                    let sse_message = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();

                    let (event_type, data) = parse_sse_message(&sse_message);

                    if data.is_empty() {
                        continue;
                    }

                    if event_type == "response.output_text.delta" {
                        let delta_event = serde_json::from_str::<DeltaEvent>(&data)
                            .context("parse OpenAI OCR SSE event: response.output_text.delta")?;
                        if let Some(delta) = delta_event.delta {
                            whole_answer.push_str(&delta);
                            channel
                                .send(Some(delta))
                                .context("forward OpenAI OCR delta to frontend channel")?;
                        }
                    }
                }
            }

            channel
                .send(None)
                .context("send OpenAI OCR streaming completion signal to frontend channel")?;
            Ok(whole_answer)
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::OpenAI
    }
}
