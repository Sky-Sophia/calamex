use serde::de::DeserializeOwned;
use serde::Serialize;
use std::env;
use std::time::Duration;

use crate::commands::contracts::{
    AgentSidecarApprovalResolveRequest, AgentSidecarChatRequest,
    AgentSidecarExecuteRequest, AgentSidecarHealthPayload, AgentSidecarPlanRequest,
    AgentSidecarResponsePayload,
};

const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:39871";
const SIDECAR_URL_ENV: &str = "XIAOJIANC_AGENT_SIDECAR_URL";
const SIDECAR_REQUEST_TIMEOUT_SECONDS: u64 = 180;

fn configured_base_url() -> String {
    normalize_base_url(env::var(SIDECAR_URL_ENV).ok().as_deref())
}

fn normalize_base_url(raw_url: Option<&str>) -> String {
    raw_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SIDECAR_URL)
        .trim_end_matches('/')
        .to_string()
}

fn build_sidecar_url(base_url: &str, path: &str) -> String {
    let normalized_base = normalize_base_url(Some(base_url));
    let normalized_path = path.trim_start_matches('/');
    format!("{normalized_base}/{normalized_path}")
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(SIDECAR_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("AGENT_SIDECAR_CLIENT_ERROR: 创建 sidecar HTTP 客户端失败：{error}"))
}

async fn decode_response<T: DeserializeOwned>(
    response: reqwest::Response,
    endpoint: &str,
) -> Result<T, String> {
    let status = response.status();
    let text = response.text().await.map_err(|error| {
        format!("AGENT_SIDECAR_READ_ERROR: 读取 sidecar 响应失败({endpoint})：{error}")
    })?;

    if !status.is_success() {
        let clipped = text.chars().take(480).collect::<String>();
        return Err(format!(
            "AGENT_SIDECAR_HTTP_ERROR: sidecar 返回 HTTP {status}({endpoint})：{clipped}"
        ));
    }

    serde_json::from_str(&text).map_err(|error| {
        format!("AGENT_SIDECAR_CONTRACT_ERROR: sidecar 响应无法解析({endpoint})：{error}")
    })
}

async fn get_json<T: DeserializeOwned>(endpoint: &str) -> Result<T, String> {
    let url = build_sidecar_url(&configured_base_url(), endpoint);
    let response = client()?
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("AGENT_SIDECAR_UNAVAILABLE: 无法连接 Node sidecar({url})：{error}"))?;

    decode_response(response, endpoint).await
}

async fn post_json<TRequest, TResponse>(
    endpoint: &str,
    payload: &TRequest,
) -> Result<TResponse, String>
where
    TRequest: Serialize,
    TResponse: DeserializeOwned,
{
    let url = build_sidecar_url(&configured_base_url(), endpoint);
    let response = client()?
        .post(&url)
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("AGENT_SIDECAR_UNAVAILABLE: 无法连接 Node sidecar({url})：{error}"))?;

    decode_response(response, endpoint).await
}

pub async fn health() -> Result<AgentSidecarHealthPayload, String> {
    get_json("/health").await
}

pub async fn chat(payload: AgentSidecarChatRequest) -> Result<AgentSidecarResponsePayload, String> {
    post_json("/agent/chat", &payload).await
}

pub async fn plan(payload: AgentSidecarPlanRequest) -> Result<AgentSidecarResponsePayload, String> {
    post_json("/agent/plan", &payload).await
}

pub async fn execute(
    payload: AgentSidecarExecuteRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    post_json("/agent/execute", &payload).await
}

pub async fn resolve_approval(
    payload: AgentSidecarApprovalResolveRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    post_json("/approval/resolve", &payload).await
}

#[cfg(test)]
mod tests {
    use super::{build_sidecar_url, normalize_base_url, DEFAULT_SIDECAR_URL};

    #[test]
    fn normalize_base_url_uses_default_when_env_is_empty() {
        assert_eq!(normalize_base_url(None), DEFAULT_SIDECAR_URL);
        assert_eq!(normalize_base_url(Some("   ")), DEFAULT_SIDECAR_URL);
    }

    #[test]
    fn normalize_base_url_strips_trailing_slash() {
        assert_eq!(
            normalize_base_url(Some("http://127.0.0.1:39871///")),
            "http://127.0.0.1:39871"
        );
    }

    #[test]
    fn build_sidecar_url_joins_endpoint_without_double_slash() {
        assert_eq!(
            build_sidecar_url("http://127.0.0.1:39871/", "/agent/chat"),
            "http://127.0.0.1:39871/agent/chat"
        );
    }
}
