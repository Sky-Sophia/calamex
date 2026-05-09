use std::collections::HashSet;

use serde_json::Value;

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai::network_permission;
use crate::ai::redaction::redact_text;
use crate::ai_tools::tavily::{post_tavily_json, read_tavily_api_key};
use crate::commands::contracts::{AiWebSearchInput, AiWebSearchPayload, AiWebSearchResultPayload};

const MAX_WEB_SEARCH_RESULTS: usize = 8;
const WEB_SEARCH_TIMEOUT_SECS: u64 = 30;
const TAVILY_SEARCH_ERROR_CODE: &str = "AI_AGENT_WEB_SEARCH_FAILED";

const ALLOWED_INTENTS: &[&str] = &[
    "official-docs",
    "api-reference",
    "error-debug",
    "best-practice",
    "release-notes",
    "general",
];

const ALLOWED_RECENCY: &[&str] = &["any", "day", "week", "month", "year"];

// ============================================================
//  公共入口
// ============================================================

pub async fn search(input: AiWebSearchInput) -> Result<AiWebSearchPayload, String> {
    search_with_permission(input, true).await
}

pub async fn search_confirmed(input: AiWebSearchInput) -> Result<AiWebSearchPayload, String> {
    search_with_permission(input, false).await
}

/// 审计事件序列（保证可回放配对）：
///   * 任何路径都先发 `Requested`
///   * 任意 gate 拒绝 → `Denied`
///   * 全部 gate 通过、即将真正出网 → `Approved`
///   * HTTP 上游错误不视为本地拒绝，故沿用 `?` 透传，不再发 `Approved` 之外的事件
async fn search_with_permission(
    input: AiWebSearchInput,
    require_runtime_permission: bool,
) -> Result<AiWebSearchPayload, String> {
    audit::emit(AiAuditEventKind::AgentWebSearchRequested);

    if let Err(error) = validate_search_input(&input) {
        audit::emit(AiAuditEventKind::AgentWebSearchDenied);
        return Err(error);
    }

    if require_runtime_permission {
        if let Err(error) = network_permission::ensure_network_allowed() {
            audit::emit(AiAuditEventKind::AgentWebSearchDenied);
            return Err(error);
        }
    }

    if redact_text(input.query.trim()).blocked {
        audit::emit(AiAuditEventKind::AgentWebSearchDenied);
        return Err(errors::error(
            "AI_AGENT_WEB_SOURCE_BLOCKED",
            "搜索 query 命中敏感信息规则，已阻止联网。",
        ));
    }

    let api_key = match read_tavily_api_key(TAVILY_SEARCH_ERROR_CODE, "官方 web_search") {
        Ok(key) => key,
        Err(error) => {
            audit::emit(AiAuditEventKind::AgentWebSearchDenied);
            return Err(error);
        }
    };

    audit::emit(AiAuditEventKind::AgentWebSearchApproved);

    let response = post_tavily_json(
        "search",
        WEB_SEARCH_TIMEOUT_SECS,
        TAVILY_SEARCH_ERROR_CODE,
        "官方 web_search",
        &api_key,
        build_tavily_search_body(&input),
    )
    .await?;

    let results = extract_tavily_results(&response, input.max_results);
    Ok(AiWebSearchPayload { results })
}

// ============================================================
//  输入校验
// ============================================================

pub fn validate_search_input(input: &AiWebSearchInput) -> Result<(), String> {
    if input.query.trim().is_empty() {
        return Err(errors::error(
            TAVILY_SEARCH_ERROR_CODE,
            "搜索 query 不能为空。",
        ));
    }

    if input.max_results == 0 || input.max_results > MAX_WEB_SEARCH_RESULTS {
        return Err(errors::error(
            TAVILY_SEARCH_ERROR_CODE,
            "搜索结果数量必须在 1~8 之间。",
        ));
    }

    if !ALLOWED_INTENTS.contains(&input.intent.as_str()) {
        return Err(errors::error(
            TAVILY_SEARCH_ERROR_CODE,
            "搜索意图不在允许范围内。",
        ));
    }

    if let Some(recency) = input.recency.as_deref() {
        if !ALLOWED_RECENCY.contains(&recency) {
            return Err(errors::error(
                TAVILY_SEARCH_ERROR_CODE,
                "搜索时间范围不在允许范围内。",
            ));
        }
    }

    Ok(())
}

// ============================================================
//  Tavily 请求构造
// ============================================================

fn build_tavily_search_body(input: &AiWebSearchInput) -> Value {
    let topic = if input.intent == "release-notes" {
        "news"
    } else {
        "general"
    };
    let mut body = serde_json::Map::new();
    body.insert(
        "query".to_string(),
        Value::String(input.query.trim().to_string()),
    );
    body.insert("topic".to_string(), Value::String(topic.to_string()));
    body.insert(
        "max_results".to_string(),
        Value::from(input.max_results.min(MAX_WEB_SEARCH_RESULTS)),
    );
    if let Some(days) = recency_to_days(input.recency.as_deref()) {
        body.insert("days".to_string(), Value::from(days));
    }
    Value::Object(body)
}

fn recency_to_days(recency: Option<&str>) -> Option<u32> {
    match recency {
        Some("day") => Some(1),
        Some("week") => Some(7),
        Some("month") => Some(30),
        Some("year") => Some(365),
        Some("any") | None => None,
        // defensive：validate_search_input 已过滤过非法值，此分支仅作兜底。
        Some(_) => None,
    }
}

// ============================================================
//  Tavily 响应解析
// ============================================================

fn extract_tavily_results(value: &Value, max_results: usize) -> Vec<AiWebSearchResultPayload> {
    let cap = max_results.min(MAX_WEB_SEARCH_RESULTS);
    let mut results = Vec::with_capacity(cap);
    let mut seen_keys: HashSet<String> = HashSet::new();

    let Some(items) = value.get("results").and_then(Value::as_array) else {
        return results;
    };

    for item in items {
        if results.len() >= cap {
            break;
        }
        let Some(url) = item.get("url").and_then(Value::as_str) else {
            continue;
        };
        let title = item
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty());
        let snippet = item
            .get("content")
            .and_then(Value::as_str)
            .or_else(|| item.get("rawContent").and_then(Value::as_str))
            .unwrap_or_default();

        push_result(&mut results, &mut seen_keys, title, url, snippet, cap);
    }

    results
}

fn push_result(
    results: &mut Vec<AiWebSearchResultPayload>,
    seen_keys: &mut HashSet<String>,
    title: Option<&str>,
    url: &str,
    snippet: &str,
    max_results: usize,
) {
    if results.len() >= max_results {
        return;
    }

    let trimmed_url = url.trim();
    if trimmed_url.is_empty() {
        return;
    }

    let dedup_key = normalize_url_for_dedup(trimmed_url);
    if !seen_keys.insert(dedup_key) {
        return;
    }

    // title 缺失/全空白时退化为完整 url，便于前端展示一个可点击的标识。
    let title_text = match title {
        Some(t) => clip_chars(t, 120),
        None => trimmed_url.to_string(),
    };

    results.push(AiWebSearchResultPayload {
        title: title_text,
        url: trimmed_url.to_string(),
        snippet: clip_chars(snippet.trim(), 300),
        source_type: classify_source_type(trimmed_url),
        fetched_at: chrono::Utc::now().to_rfc3339(),
    });
}

// ============================================================
//  URL 解析与归类
//
//  说明：为了不引入 `url` crate，这里做轻量手写解析。
//  形式假设：scheme://host[:port]/path?query#fragment
// ============================================================

fn extract_host(url: &str) -> Option<String> {
    let after_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host_with_port = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    if host_with_port.is_empty() {
        return None;
    }
    let host = host_with_port.split(':').next().unwrap_or("");
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

fn extract_path(url: &str) -> &str {
    let after_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let after_host = match after_scheme.find('/') {
        Some(idx) => &after_scheme[idx..],
        None => "",
    };
    after_host.split(['?', '#']).next().unwrap_or("")
}

/// 用于去重的归一化键：
///   * 去 fragment
///   * 过滤常见追踪参数 (utm_*, fbclid, gclid, mc_cid, mc_eid)
///   * 末尾斜杠归一
fn normalize_url_for_dedup(url: &str) -> String {
    let no_fragment = match url.split_once('#') {
        Some((before, _)) => before,
        None => url,
    };
    let (base, query) = match no_fragment.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (no_fragment, None),
    };
    let base = base.trim_end_matches('/');

    let cleaned_query: Option<String> = query.and_then(|q| {
        let kept: Vec<&str> = q
            .split('&')
            .filter(|kv| {
                let key = kv.split_once('=').map(|(k, _)| k).unwrap_or(*kv);
                let key_lower = key.to_ascii_lowercase();
                !(key_lower.starts_with("utm_")
                    || key_lower == "fbclid"
                    || key_lower == "gclid"
                    || key_lower == "mc_cid"
                    || key_lower == "mc_eid")
            })
            .collect();
        if kept.is_empty() {
            None
        } else {
            Some(kept.join("&"))
        }
    });

    match cleaned_query {
        Some(q) => format!("{base}?{q}"),
        None => base.to_string(),
    }
}

/// 优先级（高 → 低）：docs / github / forum / blog / unknown。
/// 文档子域优先于 github.com 主域，是为了让 `docs.github.com` 这类 URL 落到 docs。
fn classify_source_type(url: &str) -> String {
    let host = extract_host(url).unwrap_or_default();
    let path = extract_path(url).to_ascii_lowercase();

    if host.starts_with("docs.")
        || host.starts_with("developer.")
        || host.contains(".docs.")
        || path.starts_with("/docs")
        || path.starts_with("/doc/")
    {
        return "docs".to_string();
    }

    if host == "github.com" || host.ends_with(".github.com") || host.ends_with(".github.io") {
        return "github".to_string();
    }

    if host == "stackoverflow.com"
        || host.ends_with(".stackoverflow.com")
        || host.starts_with("discourse.")
        || host.starts_with("forum.")
        || host.ends_with(".discourse.org")
    {
        return "forum".to_string();
    }

    if host.starts_with("blog.") || host.ends_with(".blog") || path.starts_with("/blog") {
        return "blog".to_string();
    }

    "unknown".to_string()
}

// ============================================================
//  字符串截断（按 char 计数，多字节安全）
// ============================================================

fn clip_chars(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut output = String::with_capacity(value.len().min(max_chars * 4));
    for (index, character) in value.chars().enumerate() {
        if index >= max_chars {
            output.push('…');
            return output;
        }
        output.push(character);
    }
    output
}

// ============================================================
//  Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::{
        build_tavily_search_body, classify_source_type, clip_chars, extract_host, extract_path,
        extract_tavily_results, normalize_url_for_dedup, recency_to_days, validate_search_input,
    };
    use crate::commands::contracts::AiWebSearchInput;
    use serde_json::{json, Value};

    fn make_input(
        query: &str,
        intent: &str,
        max_results: usize,
        recency: Option<&str>,
    ) -> AiWebSearchInput {
        AiWebSearchInput {
            query: query.to_string(),
            intent: intent.to_string(),
            max_results,
            recency: recency.map(str::to_string),
        }
    }

    // --- validate_search_input -------------------------------

    #[test]
    fn validate_search_input_does_not_check_redaction() {
        // redaction 拦截不在 validate 这一层；本测试仅验证职责边界。
        let input = make_input("api_key=sk-test-secret-value", "general", 3, None);
        assert!(validate_search_input(&input).is_ok());
        assert!(crate::ai::redaction::redact_text(&input.query).blocked);
    }

    #[test]
    fn validate_search_input_rejects_empty_query() {
        let i = make_input("   ", "general", 3, None);
        assert!(validate_search_input(&i).is_err());
    }

    #[test]
    fn validate_search_input_rejects_invalid_count_and_intent() {
        let invalid_zero = make_input("tauri", "general", 0, None);
        let invalid_too_many = make_input("tauri", "general", 9, None);
        let invalid_intent = make_input("tauri", "other", 3, None);
        assert!(validate_search_input(&invalid_zero).is_err());
        assert!(validate_search_input(&invalid_too_many).is_err());
        assert!(validate_search_input(&invalid_intent).is_err());
    }

    #[test]
    fn validate_search_input_rejects_invalid_recency() {
        let i = make_input("tauri", "general", 3, Some("decade"));
        assert!(validate_search_input(&i).is_err());
    }

    // --- build_tavily_search_body ----------------------------

    #[test]
    fn builds_tavily_search_payload_from_query_and_recency() {
        let i = make_input("tavily web search", "release-notes", 12, Some("week"));
        let body = build_tavily_search_body(&i);
        assert_eq!(
            body.get("query").and_then(Value::as_str),
            Some("tavily web search")
        );
        assert_eq!(body.get("topic").and_then(Value::as_str), Some("news"));
        assert_eq!(body.get("max_results").and_then(Value::as_u64), Some(8));
        assert_eq!(body.get("days").and_then(Value::as_u64), Some(7));
    }

    #[test]
    fn builds_tavily_search_payload_for_general_intent_without_recency() {
        let i = make_input("tauri tutorial", "official-docs", 3, None);
        let body = build_tavily_search_body(&i);
        assert_eq!(body.get("topic").and_then(Value::as_str), Some("general"));
        assert!(body.get("days").is_none());
    }

    // --- extract_tavily_results ------------------------------

    #[test]
    fn extracts_and_deduplicates_tavily_results() {
        let value = json!({
            "results": [
                {
                    "title": "Reqwest",
                    "url": "https://docs.rs/reqwest/latest/reqwest/",
                    "content": "Rust HTTP client"
                },
                {
                    "title": "Reqwest GitHub",
                    "url": "https://github.com/seanmonstar/reqwest",
                    "content": "Rust HTTP client"
                },
                {
                    "title": "Duplicate",
                    "url": "https://github.com/seanmonstar/reqwest",
                    "content": "Duplicate result"
                },
                {
                    "title": "Utm dup",
                    "url": "https://github.com/seanmonstar/reqwest?utm_source=tavily",
                    "content": "Same page via tracking link"
                }
            ]
        });
        let results = extract_tavily_results(&value, 8);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].source_type, "docs");
        assert_eq!(results[1].source_type, "github");
    }

    #[test]
    fn extracts_falls_back_to_raw_content_when_content_missing() {
        let value = json!({
            "results": [
                { "title": "Doc", "url": "https://example.com/a", "rawContent": "raw text" }
            ]
        });
        let results = extract_tavily_results(&value, 8);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].snippet, "raw text");
    }

    #[test]
    fn extract_caps_results_to_max_search_results() {
        let mut items = Vec::new();
        for i in 0..20 {
            items.push(json!({
                "title": format!("t{i}"),
                "url": format!("https://example.com/{i}"),
                "content": ""
            }));
        }
        let value = json!({ "results": items });
        let results = extract_tavily_results(&value, 99);
        assert_eq!(results.len(), 8);
    }

    // --- recency_to_days -------------------------------------

    #[test]
    fn recency_mapping_is_strict_and_limited() {
        assert_eq!(recency_to_days(Some("day")), Some(1));
        assert_eq!(recency_to_days(Some("week")), Some(7));
        assert_eq!(recency_to_days(Some("month")), Some(30));
        assert_eq!(recency_to_days(Some("year")), Some(365));
        assert_eq!(recency_to_days(Some("any")), None);
        assert_eq!(recency_to_days(None), None);
        assert_eq!(recency_to_days(Some("decade")), None);
    }

    // --- classify_source_type --------------------------------

    #[test]
    fn classify_source_type_prefers_docs_subdomain_over_github_root() {
        assert_eq!(
            classify_source_type("https://docs.github.com/en/rest"),
            "docs"
        );
        assert_eq!(
            classify_source_type("https://developer.mozilla.org/en/Web"),
            "docs"
        );
        assert_eq!(
            classify_source_type("https://github.com/tauri-apps/tauri"),
            "github"
        );
        assert_eq!(
            classify_source_type("https://tauri-apps.github.io/"),
            "github"
        );
        assert_eq!(
            classify_source_type("https://stackoverflow.com/q/1"),
            "forum"
        );
        assert_eq!(
            classify_source_type("https://discourse.example.org/t/1"),
            "forum"
        );
        assert_eq!(
            classify_source_type("https://blog.rust-lang.org/2024/06/13"),
            "blog"
        );
        assert_eq!(
            classify_source_type("https://example.com/blog/post"),
            "blog"
        );
        assert_eq!(classify_source_type("https://example.com/"), "unknown");
    }

    // --- extract_host / extract_path -------------------------

    #[test]
    fn extract_host_handles_common_shapes() {
        assert_eq!(
            extract_host("https://docs.github.com/en/rest"),
            Some("docs.github.com".to_string())
        );
        assert_eq!(
            extract_host("HTTP://Example.COM:8080/path"),
            Some("example.com".to_string())
        );
        assert_eq!(extract_host("not-a-url"), Some("not-a-url".to_string())); // 最佳努力
        assert_eq!(extract_host(""), None);
    }

    #[test]
    fn extract_path_strips_query_and_fragment() {
        assert_eq!(extract_path("https://x.com/a/b?c=1#frag"), "/a/b");
        assert_eq!(extract_path("https://x.com"), "");
    }

    // --- normalize_url_for_dedup -----------------------------

    #[test]
    fn normalize_url_for_dedup_strips_tracking_and_trailing_slash() {
        assert_eq!(
            normalize_url_for_dedup("https://x.com/a/?utm_source=t&utm_campaign=c#frag"),
            "https://x.com/a"
        );
        assert_eq!(
            normalize_url_for_dedup("https://x.com/a?id=1&utm_medium=x"),
            "https://x.com/a?id=1"
        );
        assert_eq!(
            normalize_url_for_dedup("https://x.com/a#section"),
            "https://x.com/a"
        );
    }

    // --- clip_chars ------------------------------------------

    #[test]
    fn clip_chars_handles_multibyte_and_boundary() {
        assert_eq!(clip_chars("hello", 5), "hello");
        assert_eq!(clip_chars("hello world", 5), "hello…");
        assert_eq!(clip_chars("中文测试一二三", 4), "中文测试…");
        assert_eq!(clip_chars("", 5), "");
        assert_eq!(clip_chars("abc", 0), "");
    }
}
