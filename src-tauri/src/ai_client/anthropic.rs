use super::{TextToTextResult, ToolCall};
use crate::{
    api::impl_get_vendor_api,
    config::constant::{self, Vendor},
    db::SqliteInterface,
};
use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use tauri::ipc::Channel;

pub struct AnthropicClient {
    pub api_key: String,
    pub base_url: String,
}

#[derive(Debug, Deserialize)]
struct ContentBlockStart {
    index: u32,
    content_block: ContentBlock,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    id: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContentBlockDelta {
    index: u32,
    delta: Option<Delta>,
}

#[derive(Debug, Deserialize)]
struct Delta {
    #[serde(rename = "type")]
    delta_type: String,
    text: Option<String>,
    partial_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContentBlockStop {
    index: u32,
}

struct PendingToolCall {
    id: String,
    name: String,
    json_accumulator: String,
}

fn normalize_tools_for_anthropic(tools: Vec<Value>) -> Vec<Value> {
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
                return Value::Object(normalized);
            }

            normalized.remove("type");
            normalized.remove("strict");

            if let Some(function) = function {
                for field in ["name", "description"] {
                    if let Some(value) = function.get(field) {
                        normalized.insert(field.to_string(), value.clone());
                    }
                }

                if let Some(parameters) = function.get("parameters") {
                    normalized.insert("input_schema".to_string(), parameters.clone());
                }
            } else if let Some(parameters) = normalized.remove("parameters") {
                normalized.insert("input_schema".to_string(), parameters);
            }

            Value::Object(normalized)
        })
        .collect()
}

fn sanitize_schema_for_anthropic(schema: &mut Value) {
    match schema {
        Value::Object(obj) => {
            // Anthropic accepts only a subset of JSON Schema constraints.
            obj.remove("$schema");
            if obj
                .get("minItems")
                .and_then(|value| value.as_u64())
                .is_some_and(|min_items| min_items > 1)
            {
                obj.remove("minItems");
            }
            obj.remove("maxItems");
            obj.remove("minimum");
            obj.remove("maximum");
            obj.remove("exclusiveMinimum");
            obj.remove("exclusiveMaximum");
            obj.remove("multipleOf");
            obj.remove("minLength");
            obj.remove("maxLength");

            for value in obj.values_mut() {
                sanitize_schema_for_anthropic(value);
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_schema_for_anthropic(item);
            }
        }
        _ => {}
    }
}

impl AnthropicClient {
    pub async fn new(db: &SqliteInterface) -> Result<Self> {
        let (api_key, base_url) =
            impl_get_vendor_api(db, constant::Vendor::Anthropic.to_string().as_str())
                .await
                .context("initialize Anthropic client: load vendor credentials from database")?
                .ok_or(anyhow!("missing API credentials for vendor Anthropic"))
                .context("initialize Anthropic client: validate stored credentials")?;
        Ok(Self {
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }
}

impl super::TextToTextClient for AnthropicClient {
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
        let url = self.base_url.to_string() + "/v1/messages";
        let model_id_for_error = model_id.clone();
        let has_structured_output = output_structure.is_some();

        let mut body = json!({
            "model": model_id,
            "max_tokens": 8096,
            "stream": true,
            "system": system_prompt,
            "messages": [
                { "role": "user", "content": user_prompt }
            ]
        });

        if let Some(mut schema) = output_structure {
            sanitize_schema_for_anthropic(&mut schema);
            body["output_format"] = json!({
                "type": "json_schema",
                "schema": schema
            });
        }

        if let Some(tools_array) = tools {
            body["tools"] = json!(normalize_tools_for_anthropic(tools_array));
        }

        let mut request_builder = client
            .post(&url)
            .json(&body)
            .header("content-type", "application/json")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01");

        if has_structured_output {
            request_builder =
                request_builder.header("anthropic-beta", "structured-outputs-2025-11-13");
        }

        Box::pin(async move {
            let response = request_builder.send().await.with_context(|| {
                format!(
                    "Anthropic text-to-text streaming request failed (model: {})",
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
                            "Anthropic text-to-text streaming request failed while reading error body (model: {})",
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
                        "Anthropic text-to-text streaming API returned non-success status (model: {})",
                        model_id_for_error
                    )
                });
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut result = TextToTextResult::default();

            let mut pending_tool_calls: HashMap<u32, PendingToolCall> = HashMap::new();

            let mut stream_active = true;
            while stream_active {
                match stream.next().await {
                    Some(chunk) => {
                        let chunk = chunk.with_context(|| {
                            format!(
                                "Anthropic text-to-text streaming response chunk read failed (model: {})",
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

                    let mut event_type = String::new();
                    let mut data = String::new();

                    for line in sse_message.lines() {
                        if let Some(evt) = line.strip_prefix("event: ") {
                            event_type = evt.trim().to_string();
                        } else if let Some(d) = line.strip_prefix("data: ") {
                            data = d.trim().to_string();
                        }
                    }

                    if data.is_empty() {
                        continue;
                    }

                    match event_type.as_str() {
                        "content_block_start" => {
                            if let Ok(block_start) =
                                serde_json::from_str::<ContentBlockStart>(&data)
                            {
                                if block_start.content_block.block_type == "tool_use" {
                                    if let (Some(id), Some(name)) = (
                                        block_start.content_block.id,
                                        block_start.content_block.name,
                                    ) {
                                        pending_tool_calls.insert(
                                            block_start.index,
                                            PendingToolCall {
                                                id,
                                                name,
                                                json_accumulator: String::new(),
                                            },
                                        );
                                    }
                                }
                            }
                        }
                        "content_block_delta" => {
                            if let Ok(delta_event) =
                                serde_json::from_str::<ContentBlockDelta>(&data)
                            {
                                if let Some(delta) = delta_event.delta {
                                    match delta.delta_type.as_str() {
                                        "text_delta" => {
                                            if let Some(text) = delta.text {
                                                result.text.push_str(&text);
                                                let _ = channel.send(Some(text));
                                            }
                                        }
                                        "input_json_delta" => {
                                            if let Some(partial_json) = delta.partial_json {
                                                if let Some(pending) =
                                                    pending_tool_calls.get_mut(&delta_event.index)
                                                {
                                                    pending
                                                        .json_accumulator
                                                        .push_str(&partial_json);
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                        "content_block_stop" => {
                            if let Ok(block_stop) = serde_json::from_str::<ContentBlockStop>(&data)
                            {
                                if let Some(pending) = pending_tool_calls.remove(&block_stop.index)
                                {
                                    let arguments: Value =
                                        serde_json::from_str(&pending.json_accumulator)
                                            .unwrap_or(Value::Null);

                                    result.tool_calls.push(ToolCall {
                                        call_id: pending.id,
                                        name: pending.name,
                                        arguments,
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            let _ = channel.send(None);
            Ok(result)
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::Anthropic
    }
}

impl super::OCRClient for AnthropicClient {
    fn execute_ocr_task(
        &self,
        channel: Channel<Option<String>>,
        prompt: String,
        image: String,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + '_>> {
        let client = reqwest::Client::new();
        let url = self.base_url.to_string() + "/v1/messages";
        let model_id_for_error = model_id.clone();

        let body = json!({
            "model": model_id,
            "max_tokens": 4096,
            "stream": true,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ]
        });

        let request_builder = client
            .post(&url)
            .json(&body)
            .header("Content-Type", "application/json")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01");

        Box::pin(async move {
            let response = request_builder.send().await.with_context(|| {
                format!(
                    "Anthropic OCR streaming request failed (model: {})",
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
                            "Anthropic OCR streaming request failed while reading error body (model: {})",
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
                        "Anthropic OCR streaming API returned non-success status (model: {})",
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
                        "Anthropic OCR streaming response chunk read failed (model: {})",
                        model_id_for_error
                    )
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find("\n\n") {
                    let sse_message = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();

                    let mut event_type = String::new();
                    let mut data = String::new();

                    for line in sse_message.lines() {
                        if let Some(evt) = line.strip_prefix("event: ") {
                            event_type = evt.trim().to_string();
                        } else if let Some(d) = line.strip_prefix("data: ") {
                            data = d.trim().to_string();
                        }
                    }

                    if data.is_empty() {
                        continue;
                    }

                    match event_type.as_str() {
                        "content_block_delta" => {
                            let delta_event = serde_json::from_str::<ContentBlockDelta>(&data)
                                .context("parse Anthropic OCR SSE event: content_block_delta")?;
                            if let Some(delta) = delta_event.delta {
                                if let Some(text) = delta.text {
                                    whole_answer.push_str(&text);
                                    channel.send(Some(text)).context(
                                        "forward Anthropic OCR delta to frontend channel",
                                    )?;
                                }
                            }
                        }
                        "ping"
                        | "message_start"
                        | "content_block_start"
                        | "content_block_stop"
                        | "message_delta"
                        | "message_stop" => {}
                        _ => {}
                    }
                }
            }

            channel
                .send(None)
                .context("send Anthropic OCR streaming completion signal to frontend channel")?;
            Ok(whole_answer)
        })
    }

    fn get_vendor(&self) -> Vendor {
        Vendor::Anthropic
    }
}
