use std::collections::HashSet;
use std::time::Duration;

use reqwest::header::{ACCEPT, ACCEPT_ENCODING};
use serde_json::Value;

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai::network_permission;
use crate::ai::redaction::redact_text;
use crate::commands::contracts::{AiWebSearchInput, AiWebSearchPayload, AiWebSearchResultPayload};

const MAX_WEB_SEARCH_RESULTS: usize = 8;
const WEB_SEARCH_TIMEOUT_SECS: u64 = 12;

pub async fn search(input: AiWebSearchInput) -> Result<AiWebSearchPayload, String> {
    search_with_permission(input, true).await
}

pub async fn search_confirmed(input: AiWebSearchInput) -> Result<AiWebSearchPayload, String> {
    search_with_permission(input, false).await
}

async fn search_with_permission(
    input: AiWebSearchInput,
    require_runtime_permission: bool,
) -> Result<AiWebSearchPayload, String> {
    validate_search_input(&input)?;

    if require_runtime_permission {
        if let Err(error) = network_permission::ensure_network_allowed() {
            audit::emit(AiAuditEventKind::AgentWebSearchDenied);
            return Err(error);
        }
    }

    let redacted_query = redact_text(input.query.trim());

    if redacted_query.blocked {
        audit::emit(AiAuditEventKind::AgentWebSearchDenied);
        return Err(errors::error(
            "AI_AGENT_WEB_SOURCE_BLOCKED",
            "搜索 query 命中敏感信息规则，已阻止联网。",
        ));
    }

    audit::emit(AiAuditEventKind::AgentWebSearchRequested);
    audit::emit(AiAuditEventKind::AgentWebSearchApproved);

    let url = build_duckduckgo_url(&redacted_query.text);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(WEB_SEARCH_TIMEOUT_SECS))
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
                "AI_AGENT_WEB_SEARCH_FAILED",
                format!("初始化网络搜索客户端失败：{error}"),
            )
        })?;

    let response = client
        .get(url)
        .header(ACCEPT, "application/json")
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|error| {
            errors::error(
                "AI_AGENT_WEB_SEARCH_FAILED",
                format!("网络搜索失败：{error}"),
            )
        })?;

    if !response.status().is_success() {
        return Err(errors::error(
            "AI_AGENT_WEB_SEARCH_FAILED",
            format!("网络搜索失败：HTTP {}", response.status()),
        ));
    }

    let body = response.bytes().await.map_err(|error| {
        errors::error(
            "AI_AGENT_WEB_SEARCH_FAILED",
            format!("读取网络搜索结果失败：{error}"),
        )
    })?;
    let text = String::from_utf8_lossy(body.as_ref()).to_string();
    let value = serde_json::from_str::<Value>(&text).map_err(|error| {
        errors::error(
            "AI_AGENT_WEB_SEARCH_FAILED",
            format!("解析网络搜索结果失败：{error}"),
        )
    })?;

    let results = extract_duckduckgo_results(&value, input.max_results);

    Ok(AiWebSearchPayload { results })
}

pub fn validate_search_input(input: &AiWebSearchInput) -> Result<(), String> {
    if input.query.trim().is_empty() {
        return Err(errors::error(
            "AI_AGENT_WEB_SEARCH_FAILED",
            "搜索 query 不能为空。",
        ));
    }

    if input.max_results == 0 || input.max_results > MAX_WEB_SEARCH_RESULTS {
        return Err(errors::error(
            "AI_AGENT_WEB_SEARCH_FAILED",
            "搜索结果数量必须在 1~8 之间。",
        ));
    }

    if !matches!(
        input.intent.as_str(),
        "official-docs"
            | "api-reference"
            | "error-debug"
            | "best-practice"
            | "release-notes"
            | "general"
    ) {
        return Err(errors::error(
            "AI_AGENT_WEB_SEARCH_FAILED",
            "搜索意图不在允许范围内。",
        ));
    }

    if let Some(recency) = input.recency.as_deref() {
        if !matches!(recency, "any" | "day" | "week" | "month" | "year") {
            return Err(errors::error(
                "AI_AGENT_WEB_SEARCH_FAILED",
                "搜索时间范围不在允许范围内。",
            ));
        }
    }

    Ok(())
}

fn build_duckduckgo_url(query: &str) -> String {
    format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        percent_encode_query(query)
    )
}

fn percent_encode_query(value: &str) -> String {
    let mut output = String::new();

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(char::from(byte));
            }
            b' ' => output.push('+'),
            _ => {
                output.push('%');
                output.push_str(&format!("{byte:02X}"));
            }
        }
    }

    output
}

fn extract_duckduckgo_results(value: &Value, max_results: usize) -> Vec<AiWebSearchResultPayload> {
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();

    if let Some(url) = value.get("AbstractURL").and_then(Value::as_str) {
        if !url.trim().is_empty() {
            let title = value
                .get("Heading")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .unwrap_or(url);
            let snippet = value
                .get("AbstractText")
                .and_then(Value::as_str)
                .unwrap_or_default();
            push_result(
                &mut results,
                &mut seen_urls,
                title,
                url,
                snippet,
                max_results,
            );
        }
    }

    collect_topic_results(
        value.get("Results").and_then(Value::as_array),
        max_results,
        &mut results,
        &mut seen_urls,
    );
    collect_topic_results(
        value.get("RelatedTopics").and_then(Value::as_array),
        max_results,
        &mut results,
        &mut seen_urls,
    );

    results
}

fn collect_topic_results(
    topics: Option<&Vec<Value>>,
    max_results: usize,
    results: &mut Vec<AiWebSearchResultPayload>,
    seen_urls: &mut HashSet<String>,
) {
    let Some(topics) = topics else {
        return;
    };

    for topic in topics {
        if results.len() >= max_results {
            return;
        }

        if let (Some(url), Some(text)) = (
            topic.get("FirstURL").and_then(Value::as_str),
            topic.get("Text").and_then(Value::as_str),
        ) {
            push_result(results, seen_urls, text, url, text, max_results);
        }

        collect_topic_results(
            topic.get("Topics").and_then(Value::as_array),
            max_results,
            results,
            seen_urls,
        );
    }
}

fn push_result(
    results: &mut Vec<AiWebSearchResultPayload>,
    seen_urls: &mut HashSet<String>,
    title: &str,
    url: &str,
    snippet: &str,
    max_results: usize,
) {
    if results.len() >= max_results {
        return;
    }

    let normalized_url = url.trim();

    if normalized_url.is_empty() || !seen_urls.insert(normalized_url.to_string()) {
        return;
    }

    results.push(AiWebSearchResultPayload {
        title: clip_chars(title.trim(), 120),
        url: normalized_url.to_string(),
        snippet: clip_chars(snippet.trim(), 300),
        source_type: classify_source_type(normalized_url),
        fetched_at: chrono::Utc::now().to_rfc3339(),
    });
}

fn classify_source_type(url: &str) -> String {
    let lower = url.to_lowercase();

    if lower.contains("github.com") {
        return "github".to_string();
    }

    if lower.contains("stackoverflow.com")
        || lower.contains("discourse.")
        || lower.contains("forum")
    {
        return "forum".to_string();
    }

    if lower.contains("/docs") || lower.contains("docs.") || lower.contains("developer.") {
        return "docs".to_string();
    }

    if lower.contains("blog.") || lower.contains("/blog") {
        return "blog".to_string();
    }

    "unknown".to_string()
}

fn clip_chars(value: &str, max_chars: usize) -> String {
    let mut output = String::new();

    for (index, character) in value.chars().enumerate() {
        if index >= max_chars {
            output.push('…');
            return output;
        }

        output.push(character);
    }

    output
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{extract_duckduckgo_results, percent_encode_query, validate_search_input};
    use crate::commands::contracts::AiWebSearchInput;

    #[test]
    fn validate_search_input_rejects_sensitive_query() {
        let input = AiWebSearchInput {
            query: "api_key=sk-test-secret-value".to_string(),
            intent: "general".to_string(),
            max_results: 3,
            recency: None,
        };

        assert!(crate::ai::redaction::redact_text(&input.query).blocked);
        assert!(validate_search_input(&input).is_ok());
    }

    #[test]
    fn validate_search_input_rejects_invalid_count_and_intent() {
        let invalid_count = AiWebSearchInput {
            query: "tauri".to_string(),
            intent: "general".to_string(),
            max_results: 9,
            recency: None,
        };
        let invalid_intent = AiWebSearchInput {
            query: "tauri".to_string(),
            intent: "other".to_string(),
            max_results: 3,
            recency: None,
        };

        assert!(validate_search_input(&invalid_count).is_err());
        assert!(validate_search_input(&invalid_intent).is_err());
    }

    #[test]
    fn extracts_and_deduplicates_duckduckgo_results() {
        let value = json!({
            "Heading": "Reqwest",
            "AbstractURL": "https://docs.rs/reqwest/latest/reqwest/",
            "AbstractText": "Rust HTTP client",
            "RelatedTopics": [
                {
                    "Text": "reqwest github",
                    "FirstURL": "https://github.com/seanmonstar/reqwest"
                },
                {
                    "Text": "duplicate",
                    "FirstURL": "https://github.com/seanmonstar/reqwest"
                }
            ]
        });

        let results = extract_duckduckgo_results(&value, 8);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].source_type, "docs");
        assert_eq!(results[1].source_type, "github");
    }

    #[test]
    fn percent_encoding_preserves_unicode_as_utf8_bytes() {
        assert_eq!(
            percent_encode_query("Tauri 文档"),
            "Tauri+%E6%96%87%E6%A1%A3"
        );
    }
}
