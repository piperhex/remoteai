import { uiText } from "../../../../../shared/localization/uiText";
const FIELD_LABELS: Record<string, string> = {
  get model() { return uiText("client.configLabels.defaultModel"); }, get model_provider() { return uiText("client.configLabels.modelProvider"); }, get review_model() { return uiText("client.configLabels.reviewModel"); },
  get model_reasoning_effort() { return uiText("client.configLabels.reasoningEffort"); }, get plan_mode_reasoning_effort() { return uiText("client.configLabels.planningReasoningEffort"); },
  get model_reasoning_summary() { return uiText("client.configLabels.reasoningSummary"); }, get model_verbosity() { return uiText("client.configLabels.responseDetail"); }, get personality() { return uiText("client.configLabels.responseStyle"); },
  get model_context_window() { return uiText("client.configLabels.contextWindow"); }, get model_auto_compact_token_limit() { return uiText("client.configLabels.automaticCompactionThreshold"); },
  get model_auto_compact_token_limit_scope() { return uiText("client.configLabels.compactionThresholdScope"); }, get model_instructions_file() { return uiText("client.configLabels.modelInstructionsFile"); },
  get model_catalog_json() { return uiText("client.configLabels.customModelList"); }, get model_providers() { return uiText("client.configLabels.modelProviderSettings"); }, get service_tier() { return uiText("client.configLabels.serviceSpeed"); },
  get profile() { return uiText("client.configLabels.currentProfile"); }, get profiles() { return uiText("client.configLabels.profiles"); }, get approval_policy() { return uiText("client.configLabels.approvalPolicy"); },
  get approvals_reviewer() { return uiText("client.configLabels.actionReviewer"); }, get auto_review() { return uiText("client.configLabels.automaticReview"); }, get sandbox_mode() { return uiText("client.configLabels.fileAndNetworkAccess"); },
  get sandbox_workspace_write() { return uiText("client.configLabels.workspaceAccess"); }, get permissions() { return uiText("client.configLabels.permissionProfiles"); }, get default_permissions() { return uiText("client.configLabels.defaultPermissionProfile"); },
  get projects() { return uiText("client.configLabels.projectSettings"); }, get shell_environment_policy() { return uiText("client.configLabels.shellEnvironment"); }, get allow_login_shell() { return uiText("client.configLabels.allowLoginShell"); },
  get allow_symlinked_codex_home() { return uiText("client.configLabels.allowSymlinksForTheConfigurationDirectory"); }, get forced_login_method() { return uiText("client.configLabels.requiredLoginMethod"); },
  get forced_chatgpt_workspace_id() { return uiText("client.configLabels.restrictedWorkspace"); }, get cli_auth_credentials_store() { return uiText("client.configLabels.loginCredentialStorage"); },
  get mcp_oauth_credentials_store() { return uiText("client.configLabels.mcpCredentialStorage"); }, get mcp_oauth_callback_port() { return uiText("client.configLabels.mcpAuthorizationCallbackPort"); },
  get mcp_oauth_callback_url() { return uiText("client.configLabels.mcpAuthorizationCallbackUrl"); }, get mcp_optional_startup_grace_ms() { return uiText("client.configLabels.optionalMcpStartupWaitTime"); },
  get mcp_servers() { return uiText("client.configLabels.mcpServers"); }, get apps() { return uiText("client.configLabels.appConnections"); }, get plugins() { return uiText("client.chat.plugins"); }, get skills() { return uiText("client.chat.skills"); }, get tools() { return uiText("client.configLabels.toolSettings"); },
  get tool_suggest() { return uiText("client.configLabels.toolSuggestions"); }, get marketplaces() { return uiText("client.configLabels.pluginMarketplace"); }, get features() { return uiText("client.configLabels.featureToggles"); }, get agents() { return uiText("client.configLabels.multipleAgents"); },
  get orchestrator() { return uiText("client.configLabels.taskCoordination"); }, get goals() { return uiText("client.configLabels.goals"); }, get memories() { return uiText("client.configLabels.memory"); }, get history() { return uiText("client.configLabels.history"); }, get hooks() { return uiText("client.configLabels.hooks"); },
  get browser_use() { return uiText("client.configLabels.browser"); }, get computer_use() { return uiText("client.configLabels.computerUse"); }, get web_search() { return uiText("client.configLabels.webSearch"); }, get notify() { return uiText("client.configLabels.notificationCommand"); },
  get tui() { return uiText("client.configLabels.terminalInterface"); }, get desktop() { return uiText("client.configLabels.desktopApp"); }, get audio() { return uiText("client.configLabels.audioDevices"); }, get realtime() { return uiText("client.configLabels.realtimeVoice"); }, windows: "Windows",
  get analytics() { return uiText("client.configLabels.usageAnalytics"); }, get feedback() { return uiText("client.configLabels.feedback"); }, get notice() { return uiText("client.configLabels.notices"); }, get file_opener() { return uiText("client.configLabels.fileOpener"); },
  get instructions() { return uiText("client.configLabels.personalInstructions"); }, get developer_instructions() { return uiText("client.configLabels.developerInstructions"); }, get compact_prompt() { return uiText("client.configLabels.compactionPrompt"); },
  get experimental_compact_prompt_file() { return uiText("client.configLabels.compactionPromptFile"); }, get project_doc_max_bytes() { return uiText("client.configLabels.maximumProjectInstructionsLength"); },
  get project_doc_fallback_filenames() { return uiText("client.configLabels.fallbackProjectInstructionFiles"); }, get project_root_markers() { return uiText("client.configLabels.projectRootMarkers"); },
  get include_apps_instructions() { return uiText("client.configLabels.includeAppInstructions"); }, get include_collaboration_mode_instructions() { return uiText("client.configLabels.includeCollaborationInstructions"); },
  get include_environment_context() { return uiText("client.configLabels.includeEnvironmentContext"); }, get include_permissions_instructions() { return uiText("client.configLabels.includePermissionInstructions"); },
  get hide_agent_reasoning() { return uiText("client.configLabels.hideReasoning"); }, get show_raw_agent_reasoning() { return uiText("client.configLabels.showFullReasoning"); },
  get check_for_update_on_startup() { return uiText("client.configLabels.checkForUpdatesAtStartup"); }, get disable_paste_burst() { return uiText("client.configLabels.disableRapidPasteDetection"); },
  get suppress_unstable_features_warning() { return uiText("client.configLabels.hideExperimentalFeatureWarnings"); }, get background_terminal_max_timeout() { return uiText("client.configLabels.maximumBackgroundTerminalWait"); },
  get thread_unload_delay_secs() { return uiText("client.configLabels.idleConversationRetention"); }, get tool_output_token_limit() { return uiText("client.configLabels.toolOutputLengthLimit"); },
  get log_dir() { return uiText("client.configLabels.logDirectory"); }, get sqlite_home() { return uiText("client.configLabels.conversationDataDirectory"); }, get ghost_snapshot() { return uiText("client.configLabels.workspaceSnapshots"); }, get otel() { return uiText("client.configLabels.diagnostics"); },
  get chatgpt_base_url() { return uiText("client.configLabels.chatgptServiceUrl"); }, get openai_base_url() { return uiText("client.configLabels.openaiServiceUrl"); }, get oss_provider() { return uiText("client.configLabels.localModelProvider"); },
  get responses_api_metadata() { return uiText("client.configLabels.requestMetadata"); }, get apps_mcp_product_sku() { return uiText("client.configLabels.appProductIdentifier"); },
  get experimental_realtime_start_instructions() { return uiText("client.configLabels.realtimeVoiceStartupInstructions"); },
  get experimental_realtime_webrtc_call_base_url() { return uiText("client.configLabels.realtimeCallUrl"); },
  get experimental_realtime_ws_backend_prompt() { return uiText("client.configLabels.realtimeVoiceBackendInstructions"); },
  get experimental_realtime_ws_base_url() { return uiText("client.configLabels.realtimeVoiceConnectionUrl"); }, get experimental_realtime_ws_model() { return uiText("client.configLabels.realtimeVoiceModel"); },
  get experimental_realtime_ws_startup_context() { return uiText("client.configLabels.realtimeVoiceStartupContext"); }, get experimental_thread_store() { return uiText("client.configLabels.conversationStorage"); },
  get experimental_use_unified_exec_tool() { return uiText("client.configLabels.unifiedTerminalTool"); },
  get enabled() { return uiText("client.configLabels.enabled"); }, get disabled() { return uiText("client.configLabels.disabled"); }, get name() { return uiText("client.projectBrowser.name"); }, get description() { return uiText("client.configLabels.description"); }, get path() { return uiText("client.configLabels.path"); }, get url() { return uiText("client.configLabels.address"); },
  get command() { return uiText("client.configLabels.startupCommand"); }, get args() { return uiText("client.configLabels.startupArguments"); }, get cwd() { return uiText("client.shared.workingDirectory"); }, get env() { return uiText("client.configLabels.environmentVariables"); }, get env_vars() { return uiText("client.configLabels.environmentVariableList"); },
  get config_file() { return uiText("client.configLabels.configurationFile"); }, get config() { return uiText("client.configLabels.configurationList"); }, get base_url() { return uiText("client.configLabels.serviceUrl"); }, get env_key() { return uiText("client.configLabels.apiKeyEnvironmentVariable"); },
  get env_key_instructions() { return uiText("client.configLabels.apiKeySetupInstructions"); }, get api_key() { return uiText("client.configLabels.apiKey"); }, get experimental_bearer_token() { return uiText("client.configLabels.accessToken"); },
  get bearer_token() { return uiText("client.configLabels.accessToken"); }, get bearer_token_env_var() { return uiText("client.configLabels.tokenEnvironmentVariable"); }, get auth() { return uiText("client.configLabels.authentication"); },
  get auth_token() { return uiText("client.configLabels.authenticationToken"); }, get auth_method() { return uiText("client.configLabels.authenticationMethod"); }, get http_headers() { return uiText("client.configLabels.requestHeaders"); }, get env_http_headers() { return uiText("client.configLabels.requestHeaderEnvironmentVariables"); },
  get http_headers_helper() { return uiText("client.configLabels.headerGenerationCommand"); }, get wire_api() { return uiText("client.configLabels.apiType"); }, get requires_openai_auth() { return uiText("client.configLabels.useOpenaiAuthentication"); },
  get query_params() { return uiText("client.configLabels.requestParameters"); }, get request_max_retries() { return uiText("client.configLabels.requestRetryLimit"); }, get stream_max_retries() { return uiText("client.configLabels.responseRetryLimit"); },
  get stream_idle_timeout_ms() { return uiText("client.configLabels.responseIdleTimeout"); }, get supports_websockets() { return uiText("client.configLabels.supportRealtimeConnections"); },
  get websocket_connect_timeout_ms() { return uiText("client.configLabels.realtimeConnectionTimeout"); }, get supports_parallel_tool_calls() { return uiText("client.configLabels.supportParallelToolCalls"); },
  get supports_reasoning_summaries() { return uiText("client.configLabels.supportReasoningSummaries"); }, get startup_timeout_ms() { return uiText("client.configLabels.startupTimeoutMs"); },
  get startup_timeout_sec() { return uiText("client.configLabels.startupTimeoutSeconds"); }, get tool_timeout_sec() { return uiText("client.configLabels.toolTimeoutSeconds"); }, get required() { return uiText("client.configLabels.requireSuccessfulStartup"); },
  get enabled_tools() { return uiText("client.configLabels.allowedTools"); }, get disabled_tools() { return uiText("client.configLabels.disabledTools"); }, get oauth() { return uiText("client.configLabels.oauthLogin"); }, get scopes() { return uiText("client.configLabels.authorizationScopes"); },
  get oauth_resource() { return uiText("client.configLabels.authorizationResourceUrl"); }, get omit_tools_from() { return uiText("client.configLabels.contextsWhereToolsAreHidden"); }, get environment_id() { return uiText("client.configLabels.environmentIdentifier"); },
  get default_tools_approval_mode() { return uiText("client.configLabels.defaultToolApprovalMode"); }, get approval_mode() { return uiText("client.configLabels.approvalMode"); }, get timeout_ms() { return uiText("client.configLabels.timeoutMs"); },
  get timeout_sec() { return uiText("client.configLabels.timeoutSeconds"); }, get max_threads() { return uiText("client.configLabels.maximumParallelThreads"); }, get max_depth() { return uiText("client.configLabels.maximumCollaborationDepth"); },
  get max_concurrent_threads_per_session() { return uiText("client.configLabels.maximumAgentsPerTask"); }, get default_subagent_model() { return uiText("client.configLabels.defaultSubagentModel"); },
  get default_subagent_reasoning_effort() { return uiText("client.configLabels.defaultSubagentReasoningEffort"); }, get interrupt_message() { return uiText("client.configLabels.recordTaskInterruptions"); },
  get nickname_candidates() { return uiText("client.configLabels.nicknameCandidates"); }, get network_access() { return uiText("client.configLabels.allowNetworkAccess"); }, get writable_roots() { return uiText("client.configLabels.writableDirectories"); },
  get exclude_tmpdir_env_var() { return uiText("client.configLabels.excludeTheTemporaryDirectoryEnvironmentVariable"); }, get exclude_slash_tmp() { return uiText("client.configLabels.excludeTheSystemTemporaryDirectory"); },
  get trust_level() { return uiText("client.configLabels.projectTrustLevel"); }, get inherit() { return uiText("client.configLabels.inheritEnvironmentVariables"); }, get exclude() { return uiText("client.configLabels.excludedVariables"); },
  get include_only() { return uiText("client.configLabels.includeOnlyTheseVariables"); }, get set() { return uiText("client.configLabels.customVariables"); }, get ignore_default_excludes() { return uiText("client.configLabels.keepVariablesExcludedByDefault"); },
  get experimental_use_profile() { return uiText("client.configLabels.loadShellProfile"); }, get persistence() { return uiText("client.configLabels.historyPersistence"); }, get max_bytes() { return uiText("client.configLabels.storageSizeLimit"); },
  get animations() { return uiText("client.configLabels.animations"); }, get notifications() { return uiText("client.configLabels.notifications"); }, get notification_method() { return uiText("client.configLabels.notificationMethod"); }, get status_line() { return uiText("client.configLabels.statusLineContent"); },
  get alternate_screen() { return uiText("client.configLabels.alternateTerminalScreen"); }, get show_tooltips() { return uiText("client.configLabels.showTooltips"); }, get scroll_events_per_tick() { return uiText("client.configLabels.scrollSpeed"); },
  get theme() { return uiText("client.configLabels.theme"); }, get keymap() { return uiText("client.remoteDesktop.shortcuts"); }, get footer() { return uiText("client.configLabels.footerContent"); }, get voice() { return uiText("client.configLabels.voice"); }, get microphone() { return uiText("client.configLabels.microphone"); },
  get speaker() { return uiText("client.configLabels.speaker"); }, get input_device() { return uiText("client.configLabels.inputDevice"); }, get output_device() { return uiText("client.configLabels.outputDevice"); }, get transport() { return uiText("client.configLabels.connectionMethod"); },
  get version() { return uiText("client.configLabels.version"); }, get mode() { return uiText("client.configLabels.mode"); }, get type() { return uiText("client.configLabels.type"); }, get backend() { return uiText("client.configLabels.backendType"); }, get sandbox() { return uiText("client.configLabels.sandbox"); },
  get read() { return uiText("client.configLabels.read"); }, get write() { return uiText("client.configLabels.write"); }, get access() { return uiText("client.shared.access"); }, get filesystem() { return uiText("client.configLabels.filePermissions"); }, get network() { return uiText("client.configLabels.networkPermissions"); },
  get allow() { return uiText("client.configLabels.allow"); }, get deny() { return uiText("client.configLabels.deny"); }, get enabled_for() { return uiText("client.configLabels.enabledFor"); }, get domains() { return uiText("client.configLabels.domains"); }, get allowed_domains() { return uiText("client.configLabels.allowedDomains"); },
  get denied_domains() { return uiText("client.configLabels.blockedDomains"); }, get proxy_url() { return uiText("client.configLabels.proxyUrl"); }, get socks_url() { return uiText("client.configLabels.socksProxyUrl"); },
  get allow_local_binding() { return uiText("client.configLabels.allowLocalListening"); }, get allow_all_unix_sockets() { return uiText("client.configLabels.allowAllLocalSockets"); },
  get unsafe_allow_all_unix_sockets() { return uiText("client.configLabels.allowAllLocalSockets"); }, get allowed_unix_sockets() { return uiText("client.configLabels.allowedLocalSockets"); },
  get granular() { return uiText("client.configLabels.configureByActionType"); }, get sandbox_approval() { return uiText("client.configLabels.permissionElevationRequests"); }, get rules() { return uiText("client.configLabels.rules"); }, get skill_approval() { return uiText("client.configLabels.skillRequests"); },
  get mcp_elicitations() { return uiText("client.configLabels.mcpInteractionRequests"); }, get request_permissions() { return uiText("client.configLabels.additionalPermissionRequests"); }, get instructions_file() { return uiText("client.configLabels.instructionsFile"); },
  get max_file_size() { return uiText("client.configLabels.maximumFileSize"); }, get max_files() { return uiText("client.configLabels.maximumNumberOfFiles"); }, get exclude_patterns() { return uiText("client.configLabels.exclusionPatterns"); },
  get generate_memories() { return uiText("client.configLabels.generateMemories"); }, get use_memories() { return uiText("client.configLabels.useMemories"); }, get max_raw_memories_for_consolidation() { return uiText("client.configLabels.memoryConsolidationCount"); },
  get max_rollout_age_days() { return uiText("client.configLabels.maximumHistoryRetentionInDays"); }, get min_rollout_idle_hours() { return uiText("client.configLabels.idleHoursBeforeConsolidation"); },
  get max_unused_days() { return uiText("client.configLabels.unusedMemoryRetentionInDays"); }, get consolidation_model() { return uiText("client.configLabels.memoryConsolidationModel"); }, get extraction_model() { return uiText("client.configLabels.memoryExtractionModel"); },
  get image_generation() { return uiText("client.configLabels.imageGeneration"); }, get multi_agent() { return uiText("client.configLabels.multiAgentCollaboration"); }, get multi_agent_v2() { return uiText("client.configLabels.newMultiAgentCollaboration"); },
  get browser_use_external() { return uiText("client.configLabels.externalBrowser"); }, get in_app_browser() { return uiText("client.configLabels.builtInBrowser"); }, get in_app_chat() { return uiText("client.configLabels.builtInChat"); },
  get in_app_dictation() { return uiText("client.dictation.voiceInput"); }, get in_app_local_automation() { return uiText("client.configLabels.localAutomation"); }, get in_app_updates() { return uiText("client.downloads.appUpdates"); },
  get fast_mode() { return uiText("client.chat.fastMode.6e02d1"); }, get prevent_idle_sleep() { return uiText("client.configLabels.keepAwakeWhileRunning"); }, get respect_system_proxy() { return uiText("client.configLabels.useSystemProxy"); },
  get web_search_cached() { return uiText("client.configLabels.cachedSearch"); }, get web_search_request() { return uiText("client.configLabels.onlineSearchRequests"); }, get shell_tool() { return uiText("client.configLabels.shellTool"); },
  get unified_exec() { return uiText("client.configLabels.unifiedTerminalExecution"); }, get apply_patch_freeform() { return uiText("client.configLabels.freeFormPatches"); }, get remote_models() { return uiText("client.configLabels.remoteModels"); },
  get code_mode() { return uiText("client.configLabels.codeExecutionMode"); }, get tool_search() { return uiText("client.configLabels.toolSearch"); }, get tool_registry() { return uiText("client.configLabels.toolRegistry"); }, get view_image() { return uiText("client.shared.viewImage"); },
  get memory_tool() { return uiText("client.configLabels.memoryTool"); }, get skill_search() { return uiText("client.configLabels.skillSearch"); }, get worktrees() { return uiText("client.configLabels.separateWorkDirectories"); }, get undo() { return uiText("client.projectBrowser.undo"); },
  get remote_control() { return uiText("client.app.remoteControl"); }, get remote_plugin() { return uiText("client.configLabels.remotePlugins"); }, get plugin_hooks() { return uiText("client.configLabels.pluginHooks"); }, get plugin_sharing() { return uiText("client.configLabels.pluginSharing"); },
  get current_time_reminder() { return uiText("client.configLabels.timeReminders"); }, get context_management() { return uiText("client.configLabels.contextManagement"); }, get token_budget() { return uiText("client.configLabels.tokenBudget"); },
  get rollout_budget() { return uiText("client.configLabels.taskBudget"); }, get sleep_tool() { return uiText("client.configLabels.waitTool"); }, get search_tool() { return uiText("client.configLabels.searchTool"); }, get network_proxy() { return uiText("client.configLabels.networkProxy"); },
  get guardianv2() { return uiText("client.configLabels.newAutomaticReview"); }, get approvals() { return uiText("client.configLabels.actionReview"); }, get require_approval() { return uiText("client.configLabels.requireApproval"); }, get default() { return uiText("client.configLabels.defaultSettings"); },
};

const FIELD_HELP: Record<string, string> = {
  get model() { return uiText("client.configHelp.chooseTheDefaultModelForNewTasksOrEnterA"); },
  get model_provider() { return uiText("client.configHelp.chooseAModelProviderOrEnterTheNameOfAnother"); },
  get model_reasoning_effort() { return uiText("client.configHelp.higherReasoningEffortUsuallyTakesMoreTime"); }, get model_verbosity() { return uiText("client.configHelp.controlResponseLengthAndDetail"); },
  get profile() { return uiText("client.configHelp.enterTheNameOfAProfileConfiguredBelow"); }, get profiles() { return uiText("client.configHelp.saveSeparateModelAndPermissionSettingsForDifferentWorkflows"); },
  get model_providers() { return uiText("client.configHelp.manageServiceUrlsAuthenticationAndRequestSettings"); }, get mcp_servers() { return uiText("client.configHelp.connectLocalOrRemoteMcpTools"); },
  get approval_policy() { return uiText("client.configHelp.chooseHowYouAreAskedToApproveActions"); }, get sandbox_mode() { return uiText("client.configHelp.controlWhichFilesAndNetworksCodexCanAccess"); },
  get features() { return uiText("client.configHelp.enableFeaturesAsNeededOrLeaveThemAtTheirDefaults"); }, get desktop() { return uiText("client.configHelp.manageSettingsSavedByTheDesktopApp"); },
  get projects() { return uiText("client.configHelp.setPermissionsAndPreferencesForSpecificProjects"); }, get agents() { return uiText("client.configHelp.manageAgentRolesModelsAndTheNumberOfParallelTasks"); },
  get instructions() { return uiText("client.configHelp.tellCodexHowYouWorkAndHowYouPreferResponses"); }, get developer_instructions() { return uiText("client.configHelp.addSharedRequirementsForTasks"); },
  get service_tier() { return uiText("client.configHelp.enterDefaultPriorityOrFlex"); }, get model_context_window() { return uiText("client.configHelp.setTheContextWindowSizeInTokens"); },
  get model_auto_compact_token_limit() { return uiText("client.configHelp.compactTheContextWhenItReachesThisTokenCount"); },
  get web_search() { return uiText("client.configHelp.chooseCachedResultsLiveSearchOrDisableWebSearch"); },
  get permissions() { return uiText("client.configHelp.combineFileAndNetworkPermissionsForDifferentWorkflows"); },
  get history() { return uiText("client.configHelp.chooseWhetherToSaveTerminalHistoryAndSetItsStorage"); }, get shell_environment_policy() { return uiText("client.configHelp.controlWhichEnvironmentVariablesTheShellInheritsAndUses"); },
  get hooks() { return uiText("client.configHelp.runPredefinedActionsWhenSpecifiedEventsOccur"); }, get notify() { return uiText("client.configHelp.theCommandAndArgumentsToRunWhenANotificationIs"); },
  get memories() { return uiText("client.configHelp.configureHowMemoriesAreGeneratedUsedAndRetainedAcrossTasks"); }, get tui() { return uiText("client.configHelp.adjustTerminalAppearanceNotificationsAndKeyboardShortcuts"); },
  get marketplaces() { return uiText("client.configHelp.addOrManagePluginSources"); }, get plugins() { return uiText("client.configHelp.manageInstalledPluginsAndTheirTools"); },
};

export const TYPE_LABELS: Record<string, string> = {
  get string() { return uiText("client.chat.text"); }, get integer() { return uiText("client.configHelp.integer"); }, get number() { return uiText("client.configHelp.number"); }, get boolean() { return uiText("client.configHelp.toggle"); }, get array() { return uiText("client.configHelp.list"); }, get object() { return uiText("client.configHelp.detailedSettings"); },
};

export function stringSuggestions(key: string): string[] {
  if (key === "model_provider") return ["codex-switch-local", "openai"];
  if (key.endsWith("reasoning_effort")) return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
  if (key === "service_tier") return ["default", "priority", "flex"];
  return [];
}

const OPTION_LABELS: Record<string, string> = {
  get none() { return uiText("client.configHelp.none"); }, get minimal() { return uiText("client.configHelp.minimal"); }, get low() { return uiText("client.shared.low"); }, get medium() { return uiText("client.shared.medium"); }, get high() { return uiText("client.shared.high"); }, get xhigh() { return uiText("client.configHelp.extraHigh"); }, get max() { return uiText("client.shared.maximum"); },
  get ultra() { return uiText("client.shared.extraHigh"); }, get auto() { return uiText("client.mobile.auto"); }, get concise() { return uiText("client.configHelp.concise"); }, get detailed() { return uiText("client.configHelp.detailed"); }, get friendly() { return uiText("client.configHelp.friendly"); }, get pragmatic() { return uiText("client.configHelp.pragmatic"); },
  get "on-request"() { return uiText("client.configHelp.askWhenNeeded"); }, get never() { return uiText("client.configHelp.neverAsk"); }, get "on-failure"() { return uiText("client.configHelp.askOnFailure"); }, get untrusted() { return uiText("client.configHelp.untrusted"); },
  get "read-only"() { return uiText("client.configHelp.readOnly"); }, get "workspace-write"() { return uiText("client.configHelp.workspaceWriteAccess"); }, get "danger-full-access"() { return uiText("client.shared.fullAccess"); },
  get disabled() { return uiText("client.projectBrowser.close"); }, get enabled() { return uiText("client.configEditor.on"); }, get cached() { return uiText("client.configLabels.cachedSearch"); }, get live() { return uiText("client.configHelp.liveSearch"); }, get indexed() { return uiText("client.configHelp.indexedSearch"); },
  get default() { return uiText("client.configHelp.default"); }, get priority() { return uiText("client.configHelp.priority"); }, get flex() { return uiText("client.configHelp.flex"); }, get file() { return uiText("client.chat.files.39932f"); }, get keyring() { return uiText("client.configHelp.systemKeychain"); },
  get ephemeral() { return uiText("client.configHelp.thisSessionOnly"); }, get chatgpt() { return uiText("client.configHelp.chatgptLogin"); }, get apikey() { return uiText("client.configLabels.apiKey"); }, get trusted() { return uiText("client.configHelp.trusted"); },
  get user() { return uiText("client.configHelp.reviewMyself"); }, get auto_review() { return uiText("client.configLabels.automaticReview"); }, get allow() { return uiText("client.configLabels.allow"); }, get deny() { return uiText("client.configLabels.deny"); }, get always() { return uiText("client.configHelp.always"); },
  get "save-all"() { return uiText("client.configHelp.saveAll"); }, get all() { return uiText("client.configHelp.all"); }, get core() { return uiText("client.configHelp.basic"); }, get experimental() { return uiText("client.configHelp.experimental"); }, get plain() { return uiText("client.configHelp.plainText"); },
};

export function fieldLabel(key: string): string {
  return typeof FIELD_LABELS[key] === "string" ? FIELD_LABELS[key] : key;
}

export function fieldHelp(key: string): string | undefined {
  return typeof FIELD_HELP[key] === "string" ? FIELD_HELP[key] : undefined;
}

export function optionLabel(value: string): string {
  const label = OPTION_LABELS[value];
  return typeof label === "string" ? `${label} (${value})` : value;
}

export const CONFIG_CATEGORIES = [
  { key: "model", get label() { return uiText("client.configHelp.modelsAndResponses"); }, get description() { return uiText("client.configHelp.chooseModelsAndAdjustReasoningEffortResponseStyleAndContext"); },
    fields: ["model", "model_provider", "model_reasoning_effort", "model_verbosity", "personality", "service_tier",
      "review_model", "plan_mode_reasoning_effort", "model_reasoning_summary", "model_context_window",
      "model_auto_compact_token_limit", "model_auto_compact_token_limit_scope", "model_catalog_json",
      "model_instructions_file", "profile", "profiles", "oss_provider"] },
  { key: "permissions", get label() { return uiText("client.configHelp.permissionsAndSecurity"); }, get description() { return uiText("client.configHelp.controlActionApprovalsFileAccessAndProjectPermissions"); },
    fields: ["approval_policy", "approvals_reviewer", "auto_review", "sandbox_mode", "sandbox_workspace_write",
      "default_permissions", "permissions", "projects", "shell_environment_policy", "allow_login_shell",
      "allow_symlinked_codex_home", "forced_login_method", "forced_chatgpt_workspace_id",
      "cli_auth_credentials_store", "windows"] },
  { key: "connections", get label() { return uiText("client.configHelp.servicesAndExtensions"); }, get description() { return uiText("client.configHelp.manageModelProvidersMcpAppsPluginsAndSkills"); },
    fields: ["model_providers", "mcp_servers", "apps", "plugins", "skills", "marketplaces",
      "mcp_oauth_credentials_store", "mcp_oauth_callback_port", "mcp_oauth_callback_url",
      "mcp_optional_startup_grace_ms", "openai_base_url", "chatgpt_base_url", "apps_mcp_product_sku"] },
  { key: "tools", get label() { return uiText("client.configHelp.toolsAndAgents"); }, get description() { return uiText("client.configHelp.configureWebSearchComputerUseAndMultiAgentCollaboration"); },
    fields: ["web_search", "tools", "agents", "goals", "browser_use", "computer_use", "orchestrator",
      "tool_suggest", "hooks", "tool_output_token_limit", "background_terminal_max_timeout"] },
  { key: "behavior", get label() { return uiText("client.configHelp.instructionsAndMemory"); }, get description() { return uiText("client.configHelp.defineWorkPreferencesAndManageProjectInstructionsHistoryAndMemories"); },
    fields: ["instructions", "developer_instructions", "compact_prompt", "experimental_compact_prompt_file",
      "memories", "history", "project_doc_max_bytes", "project_doc_fallback_filenames", "project_root_markers",
      "include_apps_instructions", "include_collaboration_mode_instructions", "include_environment_context",
      "include_permissions_instructions", "ghost_snapshot"] },
  { key: "interface", get label() { return uiText("client.configHelp.appearanceAndNotifications"); }, get description() { return uiText("client.configHelp.adjustDesktopTerminalAudioAndNotificationPreferences"); },
    fields: ["desktop", "tui", "notify", "audio", "realtime", "file_opener", "hide_agent_reasoning",
      "show_raw_agent_reasoning", "check_for_update_on_startup", "disable_paste_burst", "notice", "feedback"] },
  { key: "advanced", get label() { return uiText("client.configHelp.advancedSettings"); }, get description() { return uiText("client.configHelp.manageFeatureTogglesDiagnosticsAndOtherSettings"); }, fields: [] as string[] },
];

export function categoryFor(key: string): string {
  return CONFIG_CATEGORIES.find((category) => category.fields.includes(key))?.key ?? "advanced";
}
