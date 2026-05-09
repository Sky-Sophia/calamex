use super::config::{
    build_provider_connection_candidate, save_connected_narrator, save_connected_profile,
    AiProviderConnectionCandidate,
};
use super::*;

#[derive(Debug, Clone)]
pub(super) struct AiUpstreamEndpoint {
    pub(super) provider_name: &'static str,
    pub(super) base_url: &'static str,
    pub(super) model: String,
}

async fn test_with_litellm_fallback(
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<(), String> {
    match openai_compatible::test(base_url, api_key, model).await {
        Ok(()) => Ok(()),
        Err(primary_error)
            if should_try_direct_upstream_fallback(base_url, model, &primary_error) =>
        {
            let Some(endpoint) = resolve_direct_upstream_endpoint(base_url, model) else {
                return Err(primary_error);
            };

            openai_compatible::test(endpoint.base_url, api_key, &endpoint.model)
                .await
                .map_err(|fallback_error| {
                    direct_upstream_fallback_error(&primary_error, &endpoint, &fallback_error)
                })
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn chat_with_litellm_fallback(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: AiProviderChatRequest,
) -> Result<AiProviderResponse, String> {
    match openai_compatible::chat(base_url, api_key, model, request.clone()).await {
        Ok(response) => Ok(response),
        Err(primary_error)
            if should_try_direct_upstream_fallback(base_url, model, &primary_error) =>
        {
            let Some(endpoint) = resolve_direct_upstream_endpoint(base_url, model) else {
                return Err(primary_error);
            };

            let mut response =
                openai_compatible::chat(endpoint.base_url, api_key, &endpoint.model, request)
                    .await
                    .map_err(|fallback_error| {
                        direct_upstream_fallback_error(&primary_error, &endpoint, &fallback_error)
                    })?;
            response.model = model.to_string();

            Ok(response)
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn chat_stream_with_litellm_fallback<F, C>(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: AiProviderChatRequest,
    mut on_event: F,
    is_cancelled: C,
) -> Result<(), String>
where
    F: FnMut(openai_compatible::AiProviderStreamEvent) -> Result<(), String>,
    C: Fn() -> bool,
{
    match openai_compatible::chat_stream(
        base_url,
        api_key,
        model,
        request.clone(),
        |event| on_event(event),
        || is_cancelled(),
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(primary_error)
            if should_try_direct_upstream_fallback(base_url, model, &primary_error) =>
        {
            let Some(endpoint) = resolve_direct_upstream_endpoint(base_url, model) else {
                return Err(primary_error);
            };

            openai_compatible::chat_stream(
                endpoint.base_url,
                api_key,
                &endpoint.model,
                request,
                |event| on_event(event),
                || is_cancelled(),
            )
            .await
            .map_err(|fallback_error| {
                direct_upstream_fallback_error(&primary_error, &endpoint, &fallback_error)
            })
        }
        Err(error) => Err(error),
    }
}

pub(super) fn should_try_direct_upstream_fallback(
    base_url: &str,
    model: &str,
    error: &str,
) -> bool {
    is_default_litellm_proxy_url(base_url)
        && resolve_direct_upstream_endpoint(base_url, model).is_some()
        && is_transport_connect_error(error)
}

fn is_transport_connect_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();

    normalized.contains("error sending request")
        || normalized.contains("connection refused")
        || normalized.contains("tcp connect error")
        || normalized.contains("operation timed out")
        || normalized.contains("deadline has elapsed")
}

pub(super) fn resolve_direct_upstream_endpoint(
    base_url: &str,
    model: &str,
) -> Option<AiUpstreamEndpoint> {
    if !is_default_litellm_proxy_url(base_url) {
        return None;
    }

    let (provider, upstream_model) = model.trim().split_once('/')?;
    let upstream_model = upstream_model.trim();
    if upstream_model.is_empty() {
        return None;
    }

    let (provider_name, base_url) = match provider.trim() {
        "openai" => ("OpenAI", "https://api.openai.com/v1"),
        "deepseek" => ("DeepSeek", "https://api.deepseek.com"),
        "moonshot" => ("Moonshot Kimi", "https://api.moonshot.cn/v1"),
        "dashscope" => (
            "阿里云百炼",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ),
        "zhipu" => ("智谱 GLM", "https://open.bigmodel.cn/api/paas/v4"),
        "gemini" => (
            "Google Gemini",
            "https://generativelanguage.googleapis.com/v1beta/openai",
        ),
        "ollama" => ("Ollama", "http://127.0.0.1:11434/v1"),
        _ => return None,
    };

    Some(AiUpstreamEndpoint {
        provider_name,
        base_url,
        model: upstream_model.to_string(),
    })
}

fn is_default_litellm_proxy_url(base_url: &str) -> bool {
    let normalized = base_url.trim().trim_end_matches('/');

    matches!(
        normalized,
        DEFAULT_LITELLM_BASE_URL | "http://localhost:4000/v1" | "http://[::1]:4000/v1"
    )
}

fn direct_upstream_fallback_error(
    primary_error: &str,
    endpoint: &AiUpstreamEndpoint,
    fallback_error: &str,
) -> String {
    errors::error(
        "AI_PROVIDER_UNAVAILABLE",
        format!(
            "本地 LiteLLM Proxy 不可用，已自动尝试直连 {}，但直连也失败。LiteLLM 错误：{}；直连错误：{}",
            endpoint.provider_name, primary_error, fallback_error
        ),
    )
}

async fn test_provider_connection_candidate(
    candidate: &AiProviderConnectionCandidate,
) -> Result<(), String> {
    let base_url = candidate.base_url.as_deref().ok_or_else(|| {
        errors::error("AI_PROVIDER_NOT_CONFIGURED", "请先配置 Provider API 地址。")
    })?;

    let api_key = candidate
        .api_key_for_test
        .as_deref()
        .ok_or_else(|| errors::error("AI_PROVIDER_AUTH_FAILED", "请填写 API Key。"))?;

    let model = candidate
        .selected_model
        .as_deref()
        .unwrap_or(DEFAULT_LITELLM_MODEL);

    test_with_litellm_fallback(base_url, api_key, model).await
}

pub async fn test_provider() -> Result<(), String> {
    let config = current_config()?;

    let base_url = resolve_base_url(&config)?;
    let api_key = get_api_key_for_config(&config)?;
    let model = config
        .selected_model
        .as_deref()
        .unwrap_or(DEFAULT_LITELLM_MODEL);

    test_with_litellm_fallback(base_url, &api_key, model).await
}

pub async fn test_provider_config(
    role: Option<&str>,
    provider_type: &str,
    selected_model: Option<String>,
    base_url: Option<String>,
    inline_completion_enabled: bool,
    chat_enabled: bool,
    agent_enabled: bool,
    api_key: Option<&str>,
) -> Result<(), String> {
    let role = normalize_model_role(role)?;
    let candidate = build_provider_connection_candidate(
        role,
        provider_type,
        selected_model,
        base_url,
        inline_completion_enabled,
        chat_enabled,
        agent_enabled,
        api_key,
    )?;

    test_provider_connection_candidate(&candidate).await
}

pub async fn connect_provider(
    role: Option<&str>,
    provider_type: &str,
    selected_model: Option<String>,
    base_url: Option<String>,
    inline_completion_enabled: bool,
    chat_enabled: bool,
    agent_enabled: bool,
    api_key: Option<&str>,
) -> Result<AiConfigPayload, String> {
    let role = normalize_model_role(role)?;
    let candidate = build_provider_connection_candidate(
        role,
        provider_type,
        selected_model,
        base_url,
        inline_completion_enabled,
        chat_enabled,
        agent_enabled,
        api_key,
    )?;

    test_provider_connection_candidate(&candidate).await?;

    if let Some(api_key_to_save) = candidate.api_key_for_save.as_deref() {
        CredentialStore::save_for_role(
            &candidate.provider_type,
            role.credential_role(),
            api_key_to_save,
        )?;
    }

    if role == AiResolvedModelRole::Narrator {
        return save_connected_narrator(
            candidate.provider_type,
            candidate.selected_model,
            candidate.base_url,
            candidate.api_key_for_test.as_deref(),
        );
    }

    save_connected_profile(
        AiResolvedModelRole::Main,
        candidate.provider_type,
        candidate.selected_model,
        candidate.base_url,
        candidate.inline_completion_enabled,
        candidate.chat_enabled,
        candidate.agent_enabled,
        candidate.api_key_for_test.as_deref(),
    )
}
