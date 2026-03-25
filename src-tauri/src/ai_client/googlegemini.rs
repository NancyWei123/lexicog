use super::{TextToTextResult, ToolCall};
use crate::{
    api::impl_get_vendor_api,
    config::constant::{self, Vendor},
    db::SqliteInterface,
};
use anyhow::{anyhow, Context, Error, Result};
use base64::{engine::general_purpose, Engine};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
use tauri::ipc::Channel;

pub struct GoogleGeminiClient {
    pub api_key: String,
    pub base_url: String,
}

#[derive(Debug, Deserialize)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
struct GeminiFunctionCall {
    name: String,
    args: Value,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
    #[serde(rename = "functionCall")]
    function_call: Option<GeminiFunctionCall>,
    #[serde(rename = "inlineData")]
    inline_data: Option<GeminiInlineData>,
}

fn sanitize_for_gemini_output_schema(value: &mut Value) {
    match value {
        Value::Object(obj) => {
            obj.remove("$schema");
            obj.remove("additionalProperties");

            for (_, v) in obj.iter_mut() {
                sanitize_for_gemini_output_schema(v);
            }
        }
        Value::Array(arr) => {
            for item in arr.iter_mut() {
                sanitize_for_gemini_output_schema(item);
            }
        }
        _ => {}
    }
}

fn normalize_tools_for_gemini(tools: Vec<Value>) -> Vec<Value> {
    tools
        .into_iter()
        .map(|tool| {
            let mut normalized = match tool.as_object() {
                Some(obj) => obj.clone(),
                None => return tool,
            };

            let function = normalized
                .remove("function")
                .and_then(|value| value.as_object().cloned());

            let is_function_tool = function.is_some()
                || normalized
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|tool_type| tool_type == "function");

            if !is_function_tool {
                normalized.remove("strict");
                return Value::Object(normalized);
            }

            normalized.remove("type");
            normalized.remove("strict");

            if let Some(function) = function {
                for field in ["name", "description", "parameters"] {
                    if let Some(value) = function.get(field) {
                        normalized.insert(field.to_string(), value.clone());
                    }
                }
            }

            Value::Object(normalized)
        })
        .collect()
}

impl GoogleGeminiClient {
    pub async fn new(db: &SqliteInterface) -> Result<Self> {
        let (api_key, base_url) =
            impl_get_vendor_api(db, constant::Vendor::GoogleGemini.to_string().as_str())
                .await
                .context("initialize Google Gemini client: load vendor credentials from database")?
                .ok_or(anyhow!("missing API credentials for vendor GoogleGemini"))
                .context("initialize Google Gemini client: validate stored credentials")?;
        Ok(Self {
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }
}

impl super::TextToTextClient for GoogleGeminiClient {
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
        let model_id_for_error = model_id.clone();
        let url = format!(
            "{}/models/{}:streamGenerateContent?alt=sse",
            self.base_url, model_id
        );

        let mut body = json!({
            "contents": [
                {
                    "role": "user",
                    "parts": [{ "text": user_prompt }]
                }
            ]
        });

        body["systemInstruction"] = json!({
            "parts": [{ "text": system_prompt }]
        });

        if let Some(mut schema) = output_structure {
            sanitize_for_gemini_output_schema(&mut schema);
            body["generationConfig"] = json!({
                "responseMimeType": "application/json",
                "responseJsonSchema": schema
            });
        }

        if let Some(tools_array) = tools {
            body["tools"] = json!([{
                "functionDeclarations": normalize_tools_for_gemini(tools_array)
            }]);
        }

        let request_builder = client
            .post(&url)
            .json(&body)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", &self.api_key);

        Box::pin(async move {
            let response = request_builder.send().await.with_context(|| {
                format!(
                    "Google Gemini text-to-text streaming request failed (model: {})",
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
                            "Google Gemini text-to-text streaming request failed while reading error body (model: {})",
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
                        "Google Gemini text-to-text streaming API returned non-success status (model: {})",
                        model_id_for_error
                    )
                });
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut result = TextToTextResult::default();
            let mut tool_call_counter: u32 = 0;

            let mut stream_active = true;
            while stream_active {
                match stream.next().await {
                    Some(chunk) => {
                        let chunk = chunk.with_context(|| {
                            format!(
                                "Google Gemini text-to-text streaming response chunk read failed (model: {})",
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

                    for line in sse_message.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            let data = data.trim();

                            if data.is_empty() {
                                continue;
                            }

                            if let Ok(gemini_response) =
                                serde_json::from_str::<GeminiResponse>(data)
                            {
                                let parts = gemini_response
                                    .candidates
                                    .and_then(|candidates| candidates.into_iter().next())
                                    .and_then(|candidate| candidate.content)
                                    .and_then(|content| content.parts)
                                    .unwrap_or_default();

                                for part in parts {
                                    if let Some(text) = part.text {
                                        result.text.push_str(&text);
                                        let _ = channel.send(Some(text));
                                    }

                                    if let Some(function_call) = part.function_call {
                                        tool_call_counter += 1;
                                        result.tool_calls.push(ToolCall {
                                            // Gemini does not provide a call id.
                                            call_id: format!(
                                                "gemini_call_{}_{}",
                                                function_call.name, tool_call_counter
                                            ),
                                            name: function_call.name,
                                            arguments: function_call.args,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let _ = channel.send(None);
            Ok(result)
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::GoogleGemini
    }
}

impl super::TextToSpeechClient for GoogleGeminiClient {
    fn execute_text_to_speech_task(
        &self,
        prompt: String,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send + '_>> {
        let client = reqwest::Client::new();
        let model_id_for_error = model_id.clone();
        let url = format!("{}/models/{}:generateContent", self.base_url, model_id);

        let body = json!({
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {
                            "voiceName": "Kore"
                        }
                    }
                }
            }
        });

        Box::pin(async move {
            let response = client
                .post(&url)
                .json(&body)
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", &self.api_key)
                .send()
                .await
                .with_context(|| {
                    format!(
                        "Google Gemini text-to-speech request failed (model: {})",
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
                            "Google Gemini text-to-speech request failed while reading error body (model: {})",
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
                        "Google Gemini text-to-speech API returned non-success status (model: {})",
                        model_id_for_error
                    )
                });
            }

            let response_text = response.text().await.with_context(|| {
                format!(
                    "Google Gemini text-to-speech response body read failed (model: {})",
                    model_id_for_error
                )
            })?;

            let gemini_response = serde_json::from_str::<GeminiResponse>(&response_text)
                .context("parse Google Gemini text-to-speech JSON response")?;

            let inline_data = gemini_response
                .candidates
                .and_then(|candidates| candidates.into_iter().next())
                .and_then(|candidate| candidate.content)
                .and_then(|content| content.parts)
                .and_then(|parts| parts.into_iter().next())
                .and_then(|part| part.inline_data)
                .ok_or(anyhow!(
                    "Google Gemini response does not contain inline audio data"
                ))
                .context(
                    "extract inline audio payload from Google Gemini text-to-speech response",
                )?;

            let pcm_bytes = general_purpose::STANDARD
                .decode(&inline_data.data)
                .map_err(|e| {
                    Error::from(e)
                        .context("decode base64 audio payload from Google Gemini response")
                })?;

            // Gemini TTS may return raw PCM audio, so wrap it as WAV when needed.
            let mime = inline_data.mime_type.to_lowercase();
            if mime.contains("pcm") || mime.contains("l16") || mime.contains("raw") {
                let sample_rate: u32 = mime
                    .split(';')
                    .find_map(|part| {
                        let part = part.trim();
                        part.strip_prefix("rate=")
                            .and_then(|r| r.trim().parse().ok())
                    })
                    .unwrap_or(24000);
                let channels: u16 = 1;
                let bits_per_sample: u16 = 16;
                let byte_rate = sample_rate * (channels as u32) * (bits_per_sample as u32) / 8;
                let block_align = channels * bits_per_sample / 8;
                let data_size = pcm_bytes.len() as u32;
                let file_size = 36 + data_size;

                let mut wav = Vec::with_capacity(44 + pcm_bytes.len());
                wav.extend_from_slice(b"RIFF");
                wav.extend_from_slice(&file_size.to_le_bytes());
                wav.extend_from_slice(b"WAVE");
                wav.extend_from_slice(b"fmt ");
                wav.extend_from_slice(&16u32.to_le_bytes());
                wav.extend_from_slice(&1u16.to_le_bytes());
                wav.extend_from_slice(&channels.to_le_bytes());
                wav.extend_from_slice(&sample_rate.to_le_bytes());
                wav.extend_from_slice(&byte_rate.to_le_bytes());
                wav.extend_from_slice(&block_align.to_le_bytes());
                wav.extend_from_slice(&bits_per_sample.to_le_bytes());
                wav.extend_from_slice(b"data");
                wav.extend_from_slice(&data_size.to_le_bytes());
                wav.extend_from_slice(&pcm_bytes);
                Ok(wav)
            } else {
                Ok(pcm_bytes)
            }
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::GoogleGemini
    }
}

impl super::OCRClient for GoogleGeminiClient {
    fn execute_ocr_task(
        &self,
        channel: Channel<Option<String>>,
        prompt: String,
        image: String,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + '_>> {
        let client = reqwest::Client::new();
        let model_id_for_error = model_id.clone();
        let url = format!(
            "{}/models/{}:streamGenerateContent?alt=sse",
            self.base_url, model_id
        );

        let body = json!({
            "contents": [{
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": image
                        }
                    },
                    {
                        "text": prompt
                    }
                ]
            }]
        });

        let request_builder = client
            .post(&url)
            .json(&body)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", &self.api_key);

        Box::pin(async move {
            let response = request_builder.send().await.with_context(|| {
                format!(
                    "Google Gemini OCR streaming request failed (model: {})",
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
                            "Google Gemini OCR streaming request failed while reading error body (model: {})",
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
                        "Google Gemini OCR streaming API returned non-success status (model: {})",
                        model_id_for_error
                    )
                });
            }

            let mut whole_answer = String::new();

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = stream.next().await {
                let chunk = chunk.with_context(|| {
                    format!(
                        "Google Gemini OCR streaming response chunk read failed (model: {})",
                        model_id_for_error
                    )
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find("\n\n") {
                    let sse_message = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();

                    for line in sse_message.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            let data = data.trim();

                            if data.is_empty() {
                                continue;
                            }

                            let gemini_response = serde_json::from_str::<GeminiResponse>(data)
                                .context("parse Google Gemini OCR SSE payload")?;

                            let text_parts = gemini_response
                                .candidates
                                .and_then(|candidates| candidates.into_iter().next())
                                .and_then(|candidate| candidate.content)
                                .and_then(|content| content.parts)
                                .unwrap_or_default();

                            for part in text_parts {
                                if let Some(text) = part.text {
                                    whole_answer.push_str(&text);
                                    channel.send(Some(text)).context(
                                        "forward Google Gemini OCR delta to frontend channel",
                                    )?;
                                }
                            }
                        }
                    }
                }
            }
            channel.send(None).context(
                "send Google Gemini OCR streaming completion signal to frontend channel",
            )?;
            Ok(whole_answer)
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::GoogleGemini
    }
}
