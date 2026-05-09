use std::time::Duration;

use serde_json::Value;

use crate::ai::errors;

const TAVILY_API_BASE_URL: &str = "https://api.tavily.com";
const TAVILY_API_KEY_ENV: &str = "TAVILY_API_KEY";

pub fn read_tavily_api_key(error_code: &'static str, action_label: &str) -> Result<String, String> {
    std::env::var(TAVILY_API_KEY_ENV)
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            errors::error(
                error_code,
                format!("{action_label} 需要配置 TAVILY_API_KEY。"),
            )
        })
}

pub async fn post_tavily_json(
    endpoint: &str,
    timeout_secs: u64,
    error_code: &'static str,
    action_label: &str,
    api_key: &str,
    body: Value,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Xiaojianc-Agent/0.1")
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(|error| {
            errors::error(
                error_code,
                format!("初始化{action_label}客户端失败：{error}"),
            )
        })?;

    let url = format!("{TAVILY_API_BASE_URL}/{endpoint}");
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| errors::error(error_code, format!("{action_label}失败：{error}")))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(errors::error(
            error_code,
            if error_text.trim().is_empty() {
                format!("{action_label}失败：HTTP {status}")
            } else {
                format!("{action_label}失败：HTTP {status} {error_text}")
            },
        ));
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| errors::error(error_code, format!("解析{action_label}响应失败：{error}")))
}
