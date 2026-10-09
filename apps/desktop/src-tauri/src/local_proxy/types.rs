struct ProxyRuntime {
    server: Arc<Server>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ProxySessionState {
    id: String,
    #[serde(default)]
    title: Option<String>,
    client: String,
    remote_address: Option<String>,
    connected_at: u64,
    last_seen_at: u64,
    #[serde(skip)]
    active_requests: u64,
    request_count: u64,
    provider: Option<String>,
    concurrent_routed: bool,
    account_id: Option<String>,
    account_email: Option<String>,
    model: Option<String>,
    context_tokens: Option<u64>,
    #[serde(default)]
    gui_context: Option<GuiSessionContext>,
    token_totals: ProxySessionTokenTotals,
    #[serde(skip)]
    requests: VecDeque<ProxySessionRequestState>,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct GuiSessionContext {
    capacity: Option<u64>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ProxySessionRequestState {
    id: u64,
    started_at: u64,
    model: Option<String>,
    reasoning_effort: Option<String>,
    service_tier: Option<ProxyServiceTier>,
    conversation: Option<String>,
    response: Option<String>,
    input_attachments: Vec<ProxyConversationAttachment>,
    output_attachments: Vec<ProxyConversationAttachment>,
    response_truncated: bool,
    #[serde(default)]
    interrupted: bool,
    first_response_time_ms: Option<u64>,
    #[serde(default)]
    first_token_time_ms: Option<u64>,
    response_time_ms: Option<u64>,
    usage: Option<TokenUsageValues>,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct ProxySessionTokenTotals {
    total_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    reasoning_tokens: u64,
    cached_tokens: u64,
}

impl ProxySessionTokenTotals {
    fn add_usage(&mut self, usage: &TokenUsageValues) {
        self.total_tokens = self
            .total_tokens
            .saturating_add(token_usage_total(usage).unwrap_or(0));
        self.input_tokens = self
            .input_tokens
            .saturating_add(usage.input_tokens.unwrap_or(0));
        self.output_tokens = self
            .output_tokens
            .saturating_add(usage.output_tokens.unwrap_or(0));
        self.reasoning_tokens = self
            .reasoning_tokens
            .saturating_add(usage.reasoning_tokens.unwrap_or(0));
        self.cached_tokens = self
            .cached_tokens
            .saturating_add(usage.cached_tokens.unwrap_or(0));
    }
}

struct ProxySessionRequestGuard {
    expects_event_stream: bool,
    session_id: String,
    request_id: u64,
    started_at: Instant,
}

impl ProxySessionRequestGuard {
    fn session_id(&self) -> &str {
        &self.session_id
    }

    fn request_id(&self) -> u64 {
        self.request_id
    }

    fn first_response_context(&self) -> ProxySessionFirstResponseContext {
        ProxySessionFirstResponseContext {
            session_id: self.session_id.clone(),
            request_id: self.request_id,
            started_at: self.started_at,
        }
    }
}

impl Drop for ProxySessionRequestGuard {
    fn drop(&mut self) {
        finish_proxy_session_request(
            &self.session_id,
            self.request_id,
            self.started_at.elapsed().as_millis() as u64,
        );
    }
}

struct ProxySessionFirstResponseContext {
    session_id: String,
    request_id: u64,
    started_at: Instant,
}

impl ProxySessionFirstResponseContext {
    fn record(&self) {
        record_proxy_session_first_response(
            &self.session_id,
            self.request_id,
            self.started_at.elapsed().as_millis() as u64,
        );
    }
}

struct FirstResponseCaptureReader {
    inner: Box<dyn Read + Send>,
    context: Option<ProxySessionFirstResponseContext>,
}

impl Read for FirstResponseCaptureReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(target)?;
        if count > 0 {
            if let Some(context) = self.context.take() {
                context.record();
            }
        }
        Ok(count)
    }
}

struct UpstreamPayload {
    status: u16,
    content_type: Option<String>,
    response_headers: Vec<(String, String)>,
    body: UpstreamBody,
    token_usage_account: Option<TokenUsageAccount>,
    token_usage_service_tier: Option<String>,
}

enum UpstreamBody {
    Buffered(Vec<u8>),
    Streaming(Box<dyn Read + Send>),
}

enum ActiveTarget {
    Official { model: String },
    Provider(Box<ProviderProfile>),
    ProviderGroup(Vec<ProviderProfile>),
    Aggregate(AggregateTarget),
}

struct AggregateTarget {
    config: AggregateApiConfig,
    profiles: Vec<ProviderProfile>,
}

struct AggregateForwardRequest<'a> {
    method: &'a Method,
    url: &'a str,
    headers: &'a [(String, String)],
    body: Vec<u8>,
    session_id: Option<&'a str>,
    target: &'a AggregateTarget,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct TokenUsageValues {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    cached_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Clone)]
struct TokenUsageAccount {
    account_id: String,
    account_email: String,
    active_account_generation: u64,
    auto_switch_attempt_generation: u64,
    auto_switch_eligible: bool,
    concurrent_request_started_at: Option<Instant>,
}

#[derive(Clone)]
struct TokenUsageContext {
    ts: u64,
    provider: String,
    provider_id: Option<String>,
    model: String,
    service_tier: UsageServiceTier,
    request_hash: String,
    started_at: Instant,
    content_type: Option<String>,
    expects_event_stream: bool,
    account: Option<TokenUsageAccount>,
    session_id: Option<String>,
    session_request_id: Option<u64>,
    lan_api_key_id: Option<String>,
}

#[derive(Clone, Copy)]
enum ProxyDiagnosticRoute {
    LocalHealth,
    LocalModels,
    TargetResolutionError,
    Official,
    ProviderAuto,
    ProviderChatBridge,
    ProviderResponsesPassthrough,
    ProviderPassthrough,
}

impl ProxyDiagnosticRoute {
    fn as_str(self) -> &'static str {
        match self {
            ProxyDiagnosticRoute::LocalHealth => "local_health",
            ProxyDiagnosticRoute::LocalModels => "local_models",
            ProxyDiagnosticRoute::TargetResolutionError => "target_resolution_error",
            ProxyDiagnosticRoute::Official => "official",
            ProxyDiagnosticRoute::ProviderAuto => "provider_auto",
            ProxyDiagnosticRoute::ProviderChatBridge => "provider_chat_bridge",
            ProxyDiagnosticRoute::ProviderResponsesPassthrough => "provider_responses_passthrough",
            ProxyDiagnosticRoute::ProviderPassthrough => "provider_passthrough",
        }
    }

    fn is_local(self) -> bool {
        matches!(
            self,
            ProxyDiagnosticRoute::LocalHealth | ProxyDiagnosticRoute::LocalModels
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CodexToolKind {
    Function,
    Namespace,
    Custom,
    ToolSearch,
}

#[derive(Debug, Clone)]
struct CodexToolSpec {
    kind: CodexToolKind,
    name: String,
    namespace: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct CodexToolContext {
    chat_tools: Vec<Value>,
    seen_chat_names: HashSet<String>,
    chat_name_to_spec: HashMap<String, CodexToolSpec>,
    namespace_name_to_chat_name: HashMap<(String, String), String>,
}

impl CodexToolContext {
    fn chat_tools(&self) -> &[Value] {
        &self.chat_tools
    }

    fn lookup_chat_name(&self, chat_name: &str) -> Option<&CodexToolSpec> {
        self.chat_name_to_spec.get(chat_name)
    }

    fn is_custom_tool_chat_name(&self, chat_name: &str) -> bool {
        self.lookup_chat_name(chat_name)
            .is_some_and(|spec| spec.kind == CodexToolKind::Custom)
    }

    fn chat_name_for_response_function(&self, name: &str, namespace: Option<&str>) -> String {
        if let Some(namespace) = namespace.filter(|value| !value.is_empty()) {
            if let Some(chat_name) = self
                .namespace_name_to_chat_name
                .get(&(namespace.to_string(), name.to_string()))
            {
                return chat_name.clone();
            }
            return flatten_namespace_tool_name(namespace, name);
        }

        name.to_string()
    }

    fn add_chat_tool(&mut self, chat_name: String, spec: CodexToolSpec, chat_tool: Value) {
        if chat_name.trim().is_empty() || self.seen_chat_names.contains(&chat_name) {
            return;
        }
        self.seen_chat_names.insert(chat_name.clone());
        if let Some(namespace) = spec.namespace.as_ref() {
            self.namespace_name_to_chat_name
                .insert((namespace.clone(), spec.name.clone()), chat_name.clone());
        }
        self.chat_name_to_spec.insert(chat_name, spec);
        self.chat_tools.push(chat_tool);
    }

    fn add_function_tool(&mut self, tool: &Value, namespace: Option<&str>) {
        let Some(original_name) = responses_tool_name(tool) else {
            return;
        };
        let chat_name = namespace
            .map(|namespace| flatten_namespace_tool_name(namespace, &original_name))
            .unwrap_or_else(|| original_name.clone());
        let Some(chat_tool) = responses_function_tool_to_chat_tool(tool, &chat_name) else {
            return;
        };
        let spec = CodexToolSpec {
            kind: if namespace.is_some() {
                CodexToolKind::Namespace
            } else {
                CodexToolKind::Function
            },
            name: original_name,
            namespace: namespace.map(ToString::to_string),
        };
        self.add_chat_tool(chat_name, spec, chat_tool);
    }

    fn add_custom_tool(&mut self, tool: &Value) {
        let Some(name) = responses_tool_name(tool) else {
            return;
        };
        let chat_tool = json!({
            "type": "function",
            "function": {
                "name": name,
                "description": responses_custom_tool_description(tool),
                "parameters": {
                    "type": "object",
                    "properties": {
                        CUSTOM_TOOL_INPUT_FIELD: {
                            "type": "string",
                            "description": CUSTOM_TOOL_INPUT_DESCRIPTION
                        }
                    },
                    "required": [CUSTOM_TOOL_INPUT_FIELD]
                }
            }
        });
        let spec = CodexToolSpec {
            kind: CodexToolKind::Custom,
            name: name.clone(),
            namespace: None,
        };
        self.add_chat_tool(name, spec, chat_tool);
    }

    fn add_tool_search_tool(&mut self) {
        let chat_tool = json!({
            "type": "function",
            "function": {
                "name": TOOL_SEARCH_PROXY_NAME,
                "description": "Search and load Codex tools, plugins, connectors, and MCP namespaces for the current task.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for tools or connectors to load."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of tool groups to return."
                        }
                    },
                    "required": ["query"]
                }
            }
        });
        let spec = CodexToolSpec {
            kind: CodexToolKind::ToolSearch,
            name: TOOL_SEARCH_PROXY_NAME.to_string(),
            namespace: None,
        };
        self.add_chat_tool(TOOL_SEARCH_PROXY_NAME.to_string(), spec, chat_tool);
    }

    fn add_namespace_tool(&mut self, namespace_tool: &Value) {
        let Some(namespace) = namespace_tool.get("name").and_then(Value::as_str) else {
            return;
        };
        let Some(children) = namespace_tool
            .get("tools")
            .or_else(|| namespace_tool.get("children"))
            .and_then(Value::as_array)
        else {
            return;
        };

        for child in children {
            if child.get("type").and_then(Value::as_str) == Some("function") {
                self.add_function_tool(child, Some(namespace));
            }
        }
    }

    fn add_response_tool(&mut self, tool: &Value) {
        match tool {
            Value::String(name) => self.add_custom_tool(&json!({
                "type": "custom",
                "name": name
            })),
            Value::Object(_) => match tool.get("type").and_then(Value::as_str) {
                Some("function") => self.add_function_tool(tool, None),
                Some("custom") => self.add_custom_tool(tool),
                Some("tool_search") => self.add_tool_search_tool(),
                Some("namespace") => self.add_namespace_tool(tool),
                _ => {}
            },
            _ => {}
        }
    }
}
