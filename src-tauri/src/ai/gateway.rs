use super::audit::{self, AiAuditEventKind};
use super::credential::CredentialStore;
use super::errors;
use super::openai_compatible;
use super::provider::{AiProviderChatRequest, AiProviderMessage, AiProviderResponse};
use super::redaction::redact_text;
use super::stream_manager;
use crate::ai_agent::planner::AgentPlanner;
use crate::commands::contracts::{
    AiAgentClassifyTaskPayload, AiAgentClassifyTaskRequest, AiChatRequest, AiCodeActionPayload,
    AiCodeActionRequest, AiConfigPayload, AiContextReferencePayload,
    AiConversationTitlePayload, AiConversationTitleRequest, AiInlineCompletionRangePayload,
    AiInlineCompletionRequest, AiInlineCompletionResult, AiModelEndpointConfigPayload,
    AiNarratorFactsPayload, AiNarratorRequest, AiNarratorResponsePayload,
    AiProviderProfileDetailPayload, AiProviderProfilePayload, AiProviderProfileSwitchRequest,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use tauri::{AppHandle, Emitter, Manager};

mod config;
mod connection;
mod conversation;
mod narrator;

#[cfg(test)]
mod tests;

pub use config::{
    clear_credentials, get_config, get_provider_profile_detail, list_provider_profiles,
    save_config, save_credentials, switch_provider_profile,
};
pub use connection::{connect_provider, test_provider, test_provider_config};
pub use conversation::{
    chat, chat_stream, classify_task, code_action, generate_conversation_title, inline_complete,
};
pub use narrator::{narrate_activity, narrate_activity_stream};

const MAX_AI_MESSAGES: usize = 32;
const MAX_MESSAGE_CHARS: usize = 16_000;
const MAX_CONTEXT_REFERENCES: usize = 8;
const MAX_CONTEXT_BLOCK_CHARS: usize = 12_000;
const MAX_REFERENCE_PREVIEW_CHARS: usize = 4_000;
const MAX_TITLE_SOURCE_CHARS: usize = 1_200;
const MIN_GENERATED_TITLE_CHARS: usize = 5;
const MAX_GENERATED_TITLE_CHARS: usize = 10;

const DEFAULT_LITELLM_BASE_URL: &str = "http://127.0.0.1:4000/v1";
const DEFAULT_LITELLM_MODEL: &str = "openai/gpt-5.5";
const DEFAULT_NARRATOR_MODEL: &str = "zhipu/glm-4-flash";

static CONFIG: OnceLock<Mutex<AiRuntimeConfig>> = OnceLock::new();
static STREAM_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Deserialize, Serialize)]
struct AiRuntimeConfig {
    provider_type: String,
    selected_model: Option<String>,
    base_url: Option<String>,
    #[serde(default)]
    active_profile_id: Option<String>,
    #[serde(default)]
    profiles: Vec<AiProviderProfile>,
    #[serde(default)]
    narrator: AiModelEndpointRuntimeConfig,
    inline_completion_enabled: bool,
    chat_enabled: bool,
    agent_enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct AiModelEndpointRuntimeConfig {
    provider_type: String,
    selected_model: Option<String>,
    base_url: Option<String>,
    #[serde(default)]
    active_profile_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AiResolvedModelRole {
    Main,
    Narrator,
}

impl AiResolvedModelRole {
    fn credential_role(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Narrator => "narrator",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Narrator => "narrator",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProviderProfile {
    id: String,
    #[serde(default = "default_profile_role")]
    role: String,
    name: String,
    provider_type: String,
    selected_model: Option<String>,
    base_url: Option<String>,
    inline_completion_enabled: bool,
    chat_enabled: bool,
    agent_enabled: bool,
    created_at: String,
    updated_at: String,
    #[serde(default)]
    last_used_at: Option<String>,
}

impl Default for AiRuntimeConfig {
    fn default() -> Self {
        Self {
            provider_type: "litellm".to_string(),
            selected_model: Some(DEFAULT_LITELLM_MODEL.to_string()),
            base_url: Some(DEFAULT_LITELLM_BASE_URL.to_string()),
            active_profile_id: None,
            profiles: Vec::new(),
            narrator: AiModelEndpointRuntimeConfig::default(),
            inline_completion_enabled: false,
            chat_enabled: true,
            agent_enabled: false,
        }
    }
}

impl Default for AiModelEndpointRuntimeConfig {
    fn default() -> Self {
        Self {
            provider_type: "litellm".to_string(),
            selected_model: Some(DEFAULT_NARRATOR_MODEL.to_string()),
            base_url: Some(DEFAULT_LITELLM_BASE_URL.to_string()),
            active_profile_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatStreamEventPayload {
    pub stream_id: String,
    pub assistant_message_id: String,
    pub kind: String,
    pub delta: Option<String>,
    pub message: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiNarratorStreamEventPayload {
    pub stream_id: String,
    pub run_id: String,
    pub message_id: String,
    pub turn_id: Option<String>,
    pub facts_hash: String,
    pub sequence: u32,
    pub trigger: String,
    pub kind: String,
    pub delta: Option<String>,
    pub message: Option<String>,
    pub should_show: Option<bool>,
    pub tone: Option<String>,
    pub text: Option<String>,
    pub related_files: Vec<String>,
    pub confidence: Option<String>,
    pub model: Option<String>,
}

pub struct AiChatStreamStart {
    pub stream_id: String,
    pub assistant_message_id: String,
    pub provider_type: String,
    pub model: String,
}

pub struct AiNarratorStreamStart {
    pub stream_id: String,
    pub run_id: String,
    pub message_id: String,
    pub turn_id: Option<String>,
    pub facts_hash: String,
    pub sequence: u32,
    pub trigger: String,
    pub model: String,
}

fn config_state() -> &'static Mutex<AiRuntimeConfig> {
    CONFIG.get_or_init(|| Mutex::new(load_config_from_disk().unwrap_or_default()))
}

fn current_config() -> Result<AiRuntimeConfig, String> {
    config_state()
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| errors::error("AI_PROVIDER_UNAVAILABLE", "AI 配置状态已损坏。"))
}

fn ensure_chat_enabled(config: &AiRuntimeConfig) -> Result<(), String> {
    if config.chat_enabled {
        return Ok(());
    }

    Err(errors::error(
        "AI_CHAT_DISABLED",
        "AI Chat 当前未启用，请先在设置中启用。",
    ))
}

fn to_payload(config: AiRuntimeConfig) -> AiConfigPayload {
    let has_credentials = has_credentials_for_config(&config);
    let narrator = model_endpoint_to_payload(&config.narrator, AiResolvedModelRole::Narrator);

    let is_base_url_configured = config
        .base_url
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    AiConfigPayload {
        provider_type: config.provider_type.clone(),
        selected_model: config.selected_model,
        base_url: config.base_url,
        active_profile_id: config.active_profile_id,
        is_base_url_configured,
        has_credentials,
        is_configured: has_credentials && is_base_url_configured,
        inline_completion_enabled: config.inline_completion_enabled,
        chat_enabled: config.chat_enabled,
        agent_enabled: config.agent_enabled,
        narrator,
    }
}

fn model_endpoint_to_payload(
    config: &AiModelEndpointRuntimeConfig,
    role: AiResolvedModelRole,
) -> AiModelEndpointConfigPayload {
    let is_base_url_configured = config
        .base_url
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_credentials = config
        .active_profile_id
        .as_deref()
        .map(CredentialStore::has_profile_secret)
        .unwrap_or_else(|| {
            CredentialStore::has_provider_secret_for_role(
                &config.provider_type,
                role.credential_role(),
            )
        });

    AiModelEndpointConfigPayload {
        provider_type: config.provider_type.clone(),
        selected_model: config.selected_model.clone(),
        base_url: config.base_url.clone(),
        active_profile_id: config.active_profile_id.clone(),
        is_base_url_configured,
        has_credentials,
        is_configured: has_credentials && is_base_url_configured,
    }
}

fn has_credentials_for_config(config: &AiRuntimeConfig) -> bool {
    if let Some(profile_id) = config.active_profile_id.as_deref() {
        return CredentialStore::has_profile_secret(profile_id);
    }

    CredentialStore::has_provider_secret(&config.provider_type)
}

fn get_api_key_for_config(config: &AiRuntimeConfig) -> Result<String, String> {
    if let Some(profile_id) = config.active_profile_id.as_deref() {
        return CredentialStore::get_profile_secret(profile_id);
    }

    CredentialStore::get(&config.provider_type)
}

fn get_api_key_for_model_endpoint(
    config: &AiModelEndpointRuntimeConfig,
    role: AiResolvedModelRole,
) -> Result<String, String> {
    if let Some(profile_id) = config.active_profile_id.as_deref() {
        return CredentialStore::get_profile_secret(profile_id);
    }

    CredentialStore::get_for_role(&config.provider_type, role.credential_role())
}

fn get_saved_api_key_for_candidate(
    role: AiResolvedModelRole,
    provider_type: &str,
    selected_model: Option<&str>,
    base_url: Option<&str>,
) -> Result<String, String> {
    let config = current_config()?;

    if let Some(index) = find_matching_profile_index(
        &config.profiles,
        role,
        provider_type,
        selected_model,
        base_url,
    ) {
        return CredentialStore::get_profile_secret(&config.profiles[index].id);
    }

    CredentialStore::get_for_role(provider_type, role.credential_role())
}

fn profile_to_payload(
    profile: AiProviderProfile,
    config: &AiRuntimeConfig,
) -> AiProviderProfilePayload {
    let has_profile_credentials = CredentialStore::has_profile_secret(&profile.id);
    let role = normalize_model_role(Some(&profile.role)).unwrap_or(AiResolvedModelRole::Main);
    let active_profile_id = match role {
        AiResolvedModelRole::Main => config.active_profile_id.as_deref(),
        AiResolvedModelRole::Narrator => config.narrator.active_profile_id.as_deref(),
    };
    let is_base_url_configured = profile
        .base_url
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let is_connected = has_profile_credentials
        && is_base_url_configured
        && active_profile_id == Some(profile.id.as_str());

    AiProviderProfilePayload {
        id: profile.id,
        role: role.as_str().to_string(),
        name: profile.name,
        provider_type: profile.provider_type,
        selected_model: profile.selected_model,
        base_url: profile.base_url,
        inline_completion_enabled: profile.inline_completion_enabled,
        chat_enabled: profile.chat_enabled,
        agent_enabled: profile.agent_enabled,
        has_credentials: has_profile_credentials,
        is_connected,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        last_used_at: profile.last_used_at,
    }
}

fn find_matching_profile_index(
    profiles: &[AiProviderProfile],
    role: AiResolvedModelRole,
    provider_type: &str,
    selected_model: Option<&str>,
    base_url: Option<&str>,
) -> Option<usize> {
    profiles.iter().position(|profile| {
        profile.role == role.as_str()
            && profile.provider_type == provider_type
            && profile.selected_model.as_deref() == selected_model
            && profile.base_url.as_deref() == base_url
    })
}

fn generate_profile_id() -> String {
    format!(
        "ai-profile-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        STREAM_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn build_profile_name(selected_model: Option<&str>, base_url: Option<&str>) -> String {
    let model = selected_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未选择模型");
    let base_url = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_LITELLM_BASE_URL);

    if base_url == DEFAULT_LITELLM_BASE_URL {
        return model.to_string();
    }

    format!("{model} · {base_url}")
}

fn normalize_model_role(role: Option<&str>) -> Result<AiResolvedModelRole, String> {
    match role.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("main") => Ok(AiResolvedModelRole::Main),
        Some("narrator") => Ok(AiResolvedModelRole::Narrator),
        Some(_) => Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "AI 模型用途无效。",
        )),
    }
}

fn default_profile_role() -> String {
    AiResolvedModelRole::Main.as_str().to_string()
}

fn validate_provider(provider_type: &str) -> Result<(), String> {
    match provider_type {
        "litellm" => Ok(()),
        _ => Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "当前版本只支持 LiteLLM Proxy Provider。",
        )),
    }
}

fn normalize_base_url(
    provider_type: &str,
    base_url: Option<String>,
) -> Result<Option<String>, String> {
    let value = base_url
        .map(|item| item.trim().trim_end_matches('/').to_string())
        .filter(|item| !item.is_empty())
        .or_else(|| default_base_url(provider_type))
        .unwrap_or_else(|| DEFAULT_LITELLM_BASE_URL.to_string());

    if !is_allowed_base_url(&value) {
        return Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "AI Provider 地址必须使用 HTTPS；本地调试仅允许 http://localhost、http://127.0.0.1 或 http://[::1]。",
        ));
    }

    Ok(Some(value))
}

fn is_allowed_base_url(value: &str) -> bool {
    value.starts_with("https://")
        || value.starts_with("http://localhost")
        || value.starts_with("http://127.0.0.1")
        || value.starts_with("http://[::1]")
}

fn default_model(provider_type: &str) -> Option<String> {
    match provider_type {
        "litellm" => Some(DEFAULT_LITELLM_MODEL.to_string()),
        _ => None,
    }
}

fn default_base_url(provider_type: &str) -> Option<String> {
    match provider_type {
        "litellm" => Some(DEFAULT_LITELLM_BASE_URL.to_string()),
        _ => None,
    }
}

fn resolve_base_url(config: &AiRuntimeConfig) -> Result<&str, String> {
    config
        .base_url
        .as_deref()
        .ok_or_else(|| errors::error("AI_PROVIDER_NOT_CONFIGURED", "请先配置 Provider API 地址。"))
}

fn resolve_model_endpoint_base_url(config: &AiModelEndpointRuntimeConfig) -> Result<&str, String> {
    config.base_url.as_deref().ok_or_else(|| {
        errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "请先配置 Narrator Provider API 地址。",
        )
    })
}

fn next_runtime_id(prefix: &str) -> String {
    let sequence = STREAM_SEQUENCE.fetch_add(1, Ordering::Relaxed);

    format!(
        "{}-{}-{}",
        prefix,
        chrono::Utc::now().timestamp_millis(),
        sequence
    )
}

fn sanitize_fenced_text(value: &str) -> String {
    value.replace("```", "`\u{200b}``")
}

fn config_file_path() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))?;

    Some(base.join("Calamex").join("ai-config.json"))
}

fn load_config_from_disk() -> Option<AiRuntimeConfig> {
    let path = config_file_path()?;
    let content = fs::read_to_string(path).ok()?;

    serde_json::from_str::<AiRuntimeConfig>(&content)
        .ok()
        .map(normalize_runtime_config)
}

fn normalize_runtime_config(mut config: AiRuntimeConfig) -> AiRuntimeConfig {
    if validate_provider(&config.provider_type).is_err() {
        return AiRuntimeConfig::default();
    }

    let selected_model = config
        .selected_model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| default_model(&config.provider_type));
    let base_url = config
        .base_url
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| default_base_url(&config.provider_type));

    config.selected_model = selected_model;
    config.base_url = base_url;
    config.narrator = normalize_model_endpoint_config(config.narrator)
        .unwrap_or_else(AiModelEndpointRuntimeConfig::default);
    config.profiles = config
        .profiles
        .into_iter()
        .filter_map(normalize_provider_profile)
        .collect();

    if config.active_profile_id.as_deref().is_some_and(|profile_id| {
        !config
            .profiles
            .iter()
            .any(|profile| profile.role == AiResolvedModelRole::Main.as_str() && profile.id == profile_id)
    }) {
        config.active_profile_id = None;
    }

    if config
        .narrator
        .active_profile_id
        .as_deref()
        .is_some_and(|profile_id| {
            !config.profiles.iter().any(|profile| {
                profile.role == AiResolvedModelRole::Narrator.as_str() && profile.id == profile_id
            })
        })
    {
        config.narrator.active_profile_id = None;
    }

    config
}

fn normalize_model_endpoint_config(
    mut config: AiModelEndpointRuntimeConfig,
) -> Option<AiModelEndpointRuntimeConfig> {
    if validate_provider(&config.provider_type).is_err() {
        return None;
    }

    config.selected_model = config
        .selected_model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| Some(DEFAULT_NARRATOR_MODEL.to_string()));
    config.base_url = config
        .base_url
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| default_base_url(&config.provider_type));
    config.active_profile_id = config
        .active_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Some(config)
}

fn normalize_provider_profile(mut profile: AiProviderProfile) -> Option<AiProviderProfile> {
    let role = normalize_model_role(Some(&profile.role)).ok()?;

    if profile.id.trim().is_empty() || validate_provider(&profile.provider_type).is_err() {
        return None;
    }

    profile.id = profile.id.trim().to_string();
    profile.role = role.as_str().to_string();
    profile.name = profile.name.trim().to_string();
    profile.selected_model = profile
        .selected_model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    profile.base_url = profile
        .base_url
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| default_base_url(&profile.provider_type));

    if profile.name.is_empty() {
        profile.name = build_profile_name(
            profile.selected_model.as_deref(),
            profile.base_url.as_deref(),
        );
    }

    Some(profile)
}

fn persist_config(config: &AiRuntimeConfig) -> Result<(), String> {
    let Some(path) = config_file_path() else {
        return Ok(());
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            errors::error(
                "AI_PROVIDER_UNAVAILABLE",
                &format!("AI 配置目录创建失败：{error}"),
            )
        })?;
    }

    let content = serde_json::to_string_pretty(config).map_err(|error| {
        errors::error(
            "AI_RESPONSE_INVALID",
            &format!("AI 配置序列化失败：{error}"),
        )
    })?;

    fs::write(path, content).map_err(|error| {
        errors::error(
            "AI_PROVIDER_UNAVAILABLE",
            &format!("AI 配置保存失败：{error}"),
        )
    })
}
