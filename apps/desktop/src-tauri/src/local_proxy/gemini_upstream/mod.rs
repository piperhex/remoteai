//! Native GenerateContent transport with Responses-compatible output events.

mod continuation;
mod framing;
mod grounding;
mod history;
mod media;
mod request;
mod request_options;
mod response;
mod stream;
mod url;

#[cfg(test)]
mod correctness_tests;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod signature_tests;
#[cfg(test)]
mod stream_tests;
#[cfg(test)]
mod tests;

use serde_json::Value;
use std::io::Cursor;
use tiny_http::Method;

use super::request_error::{Problem, RequestError, Stage};
use super::{CodexToolContext, UpstreamBody, UpstreamPayload};
use crate::models::ProviderProfile;

const GENERATED_CALL_PREFIX: &str = "gemini_call_";

#[derive(Debug, thiserror::Error)]
enum BridgeError {
    #[error("The request contains unsupported message content")]
    UnsupportedContent,
    #[error("A tool call or result contains invalid arguments")]
    InvalidToolCall,
    #[error("An attached image or file uses an unsupported format")]
    InvalidMedia,
    #[error("The model name or service address is invalid")]
    InvalidEndpoint,
    #[error(transparent)]
    Detailed(RequestError),
    #[error("The selected service cannot apply the requested search restrictions")]
    UnsupportedSearchOptions,
    #[error("Generation settings must request exactly one response candidate")]
    UnsupportedGenerationOptions,
    #[error("The previous response is unavailable. Resend the conversation history or start a new conversation.")]
    MissingHistory,
    #[error("The selected service cannot enforce this tool choice, call limit, or serial tool execution")]
    UnsupportedToolOptions,
}

impl BridgeError {
    fn detail(self) -> RequestError {
        match self {
            Self::Detailed(error) => error,
            Self::InvalidToolCall => RequestError::new(Stage::Gemini, Problem::InvalidTool),
            Self::UnsupportedContent => {
                RequestError::new(Stage::Gemini, Problem::UnsupportedResponseContent)
            }
            _ => RequestError::new(Stage::Gemini, Problem::InvalidEvent),
        }
    }
}

struct Context {
    model: String,
    tools: CodexToolContext,
    scope: Option<continuation::Scope>,
    streaming: bool,
    previous: Option<history::Snapshot>,
}

pub(super) fn forward(
    method: &Method,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    if *method != Method::Post {
        return Err("Content generation requests must use POST".into());
    }
    let input: Value = serde_json::from_slice(&body)
        .map_err(|error| RequestError::json(Stage::Request, &error).wire())?;
    if !input.is_object() {
        return Err("The request body must be a JSON object".into());
    }
    let model = super::selected_provider_model(&input, provider);
    let mut context = Context {
        scope: continuation::Scope::new(provider, headers, &model),
        tools: super::build_codex_tool_context_from_request(&input),
        model,
        streaming: input["stream"].as_bool().unwrap_or(false),
        previous: None,
    };
    context.previous =
        history::restore(&input, context.scope.as_ref()).map_err(|error| error.to_string())?;
    if input.get("tools").is_none() {
        if let Some(previous) = &context.previous {
            context.tools = previous.tools.clone();
        }
    }
    let mut body = request::convert(&input, &context).map_err(|error| error.to_string())?;
    super::provider_request_options::body(&mut body, provider);
    request_options::validate(&body).map_err(|error| error.to_string())?;
    let response = send(&body, headers, provider, &context)?;
    let pending = history::Pending::new(&context, &body);
    receive(response, context, pending)
}

fn send(
    body: &Value,
    headers: &[(String, String)],
    provider: &ProviderProfile,
    context: &Context,
) -> Result<super::ReqwestResponse, String> {
    let endpoint = url::endpoint(provider, &context.model, context.streaming)
        .map_err(|error| error.to_string())?;
    let client = super::http_client()?;
    let headers = headers
        .iter()
        .filter(|(name, _)| !name.eq_ignore_ascii_case("x-goog-api-key"))
        .cloned()
        .collect::<Vec<_>>();
    super::send_with_timeout_retries(
        || {
            let request = super::apply_forward_headers(client.post(&endpoint), &headers, true);
            let request = if provider.api_key.trim().is_empty() {
                request
            } else {
                request.header("x-goog-api-key", provider.api_key.trim())
            };
            super::provider_request_options::headers(request.json(body), provider)
        },
        "Content generation request failed",
    )
}

fn receive(
    response: super::ReqwestResponse,
    context: Context,
    pending: Option<history::Pending>,
) -> Result<UpstreamPayload, String> {
    framing::receive(response, context, pending)
}

fn buffered(
    bytes: &[u8],
    context: &Context,
    pending: Option<history::Pending>,
) -> Result<UpstreamBody, String> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| RequestError::json(Stage::Gemini, &error).wire())?;
    let chat = response::to_chat(&value, context).map_err(|error| error.detail().wire())?;
    if context.streaming {
        let mut chunk = chat.clone();
        chunk["choices"][0]["delta"] = chunk["choices"][0]["message"].take();
        let reader = Cursor::new(format!("data: {chunk}\n\ndata: [DONE]\n\n").into_bytes());
        let reader =
            super::ChatSseReader::new(reader, context.model.clone(), context.tools.clone(), None);
        capture_buffered(pending, reader.response_id(), &value, &chat);
        return Ok(UpstreamBody::Streaming(Box::new(reader)));
    }
    let response = super::chat_to_responses_json(&chat, &context.tools, None);
    capture_buffered(
        pending,
        response["id"].as_str().unwrap_or_default(),
        &value,
        &chat,
    );
    serde_json::to_vec(&response)
        .map(UpstreamBody::Buffered)
        .map_err(|_| RequestError::new(Stage::Gemini, Problem::Encode).wire())
}

fn capture_buffered(pending: Option<history::Pending>, id: &str, native: &Value, chat: &Value) {
    let Some(pending) = pending else { return };
    if native["candidates"][0]["finishReason"] != "STOP" {
        return;
    }
    pending.bind(id);
    let parts = native["candidates"][0]["content"]["parts"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let calls = chat["choices"][0]["message"]["tool_calls"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    pending.capture(parts, calls);
}
