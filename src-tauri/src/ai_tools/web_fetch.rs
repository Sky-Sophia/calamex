use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai::network_permission;
use crate::ai_tools::tavily::{post_tavily_json, read_tavily_api_key};
use crate::commands::contracts::{AiWebFetchInput, AiWebFetchPayload, AiWebFetchResultPayload};

const MAX_WEB_FETCH_BYTES: usize = 512 * 1024;
const WEB_FETCH_TIMEOUT_SECS: u64 = 30;
const WEB_EXCERPT_CHARS: usize = 600;
const TAVILY_FETCH_ERROR_CODE: &str = "AI_AGENT_WEB_FETCH_FAILED";

/// 网页正文引用的最大缓存条数，超过后按 FIFO 淘汰。
/// 防止长会话下 `text_refs` 内存无界增长。
const TEXT_REF_CAPACITY: usize = 64;

static WEB_TEXT_REFS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static WEB_TEXT_REF_ORDER: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

fn text_refs() -> &'static Mutex<HashMap<String, String>> {
    WEB_TEXT_REFS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn text_ref_order() -> &'static Mutex<VecDeque<String>> {
    WEB_TEXT_REF_ORDER.get_or_init(|| Mutex::new(VecDeque::new()))
}

// ============================================================
//  公共入口
// ============================================================

pub async fn fetch(input: AiWebFetchInput) -> Result<AiWebFetchPayload, String> {
    fetch_with_permission(input, true).await
}

pub async fn fetch_confirmed(input: AiWebFetchInput) -> Result<AiWebFetchPayload, String> {
    fetch_with_permission(input, false).await
}

/// 审计事件配对（保证可回放）：
///   * 入口必发 `Requested`
///   * 出口必发 `Completed` / `Failed`，二者之一
async fn fetch_with_permission(
    input: AiWebFetchInput,
    require_runtime_permission: bool,
) -> Result<AiWebFetchPayload, String> {
    audit::emit(AiAuditEventKind::AgentWebFetchRequested);
    let result = fetch_inner(input, require_runtime_permission).await;
    match &result {
        Ok(_) => audit::emit(AiAuditEventKind::AgentWebFetchCompleted),
        Err(_) => audit::emit(AiAuditEventKind::AgentWebFetchFailed),
    }
    result
}

/// 真正的执行体。所有 `?` 错误都会被外层捕捉并发出 `Failed`。
/// 闸口顺序遵循「便宜的先做、贵的后做」：
///   1. URL 校验（纯解析）
///   2. reason 校验（纯字符串）
///   3. network_permission（运行时开关）
///   4. 真正出网
async fn fetch_inner(
    input: AiWebFetchInput,
    require_runtime_permission: bool,
) -> Result<AiWebFetchPayload, String> {
    let url = validate_fetch_url(&input.url)?;

    let reason = input.reason.trim();
    if reason.is_empty() {
        return Err(errors::error(
            TAVILY_FETCH_ERROR_CODE,
            "读取网页必须提供用途说明。",
        ));
    }

    if require_runtime_permission {
        network_permission::ensure_network_allowed()?;
    }

    let max_bytes = input.max_bytes.min(MAX_WEB_FETCH_BYTES).max(1);

    let api_key = read_tavily_api_key(TAVILY_FETCH_ERROR_CODE, "官方 web_extract")?;
    let response = post_tavily_json(
        "extract",
        WEB_FETCH_TIMEOUT_SECS,
        TAVILY_FETCH_ERROR_CODE,
        "官方 web_extract",
        &api_key,
        json!({
            "urls": [url.to_string()],
            "extract_depth": "basic",
            "format": "markdown",
            "include_images": false,
            "include_favicon": true,
            "include_usage": false,
        }),
    )
    .await?;

    let extracted = extract_tavily_fetch_result(&response, &url.to_string())?;
    let raw_text = extracted.raw_content;

    // truncated 反映「原始正文是否超过 max_bytes」。bytes 反映「实际落盘的字节数」，
    // 二者不必相等（UTF-8 边界裁剪后，clipped.len() 可能略小于 max_bytes）。
    let truncated = raw_text.len() > max_bytes;
    let clipped = clip_to_byte_limit(&raw_text, max_bytes);

    let title = extracted
        .title
        .or_else(|| extract_html_title(&clipped))
        .unwrap_or_else(|| url.to_string());

    let excerpt = clip_chars(&normalize_excerpt_text(&clipped), WEB_EXCERPT_CHARS);
    let text_ref = store_text_ref(&url.to_string(), &clipped)?;

    Ok(AiWebFetchPayload {
        source: AiWebFetchResultPayload {
            url: url.to_string(),
            title,
            text_ref,
            excerpt,
            bytes: clipped.len(),
            fetched_at: chrono::Utc::now().to_rfc3339(),
            truncated,
        },
    })
}

// ============================================================
//  URL 与 IP 校验（防 SSRF）
// ============================================================

pub fn validate_fetch_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value.trim())
        .map_err(|_| errors::error("AI_AGENT_WEB_SOURCE_BLOCKED", "web_fetch URL 格式无效。"))?;

    match url.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(errors::error(
                "AI_AGENT_WEB_SOURCE_BLOCKED",
                "web_fetch 只允许访问 http / https URL。",
            ));
        }
    }

    let Some(host) = url.host_str() else {
        return Err(errors::error(
            "AI_AGENT_WEB_SOURCE_BLOCKED",
            "web_fetch URL 缺少主机名。",
        ));
    };

    let host_lower = host.to_ascii_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return Err(errors::error(
            "AI_AGENT_WEB_SOURCE_BLOCKED",
            "web_fetch 禁止访问 localhost。",
        ));
    }

    // reqwest::Url::host_str() 对 IPv6 已经去除方括号；trim_matches 仅做兜底。
    let ip_candidate = host_lower.trim_matches(['[', ']']);
    if let Ok(ip) = ip_candidate.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err(errors::error(
                "AI_AGENT_WEB_SOURCE_BLOCKED",
                "web_fetch 禁止访问内网或本机 IP。",
            ));
        }
    }

    Ok(url)
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => is_blocked_ipv4(v),
        IpAddr::V6(v) => is_blocked_ipv6(v),
    }
}

fn is_blocked_ipv4(value: Ipv4Addr) -> bool {
    let first = value.octets()[0];
    value.is_private()             // 10/8, 172.16/12, 192.168/16
        || value.is_loopback()     // 127/8
        || value.is_link_local()   // 169.254/16
        || value.is_unspecified()  // 0.0.0.0
        || value.is_multicast()    // 224.0.0.0/4
        || first == 0              // 0.0.0.0/8 全段保留
        || first >= 240            // 240.0.0.0/4 Class E 保留
        || first == 100 && (value.octets()[1] & 0xc0) == 64 // 100.64/10 CGNAT
}

fn is_blocked_ipv6(value: Ipv6Addr) -> bool {
    // IPv4-mapped (::ffff:0:0/96)：防止 `::ffff:127.0.0.1` 绕过 IPv4 检查。
    if let Some(mapped) = value.to_ipv4_mapped() {
        return is_blocked_ipv4(mapped);
    }
    let s0 = value.segments()[0];
    value.is_loopback()                          // ::1
        || value.is_unspecified()                // ::
        || (s0 & 0xfe00) == 0xfc00               // fc00::/7  unique local
        || (s0 & 0xffc0) == 0xfe80               // fe80::/10 link-local
        || (s0 & 0xff00) == 0xff00 // ff00::/8  multicast
}

// ============================================================
//  Text-ref 存储（带 FIFO 上限，防止内存无界）
// ============================================================

fn store_text_ref(url: &str, text: &str) -> Result<String, String> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    text.len().hash(&mut hasher);
    chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_default()
        .hash(&mut hasher);
    let text_ref = format!("web-text:{:016x}", hasher.finish());

    // 锁顺序固定：先 map 后 order，全局保持一致避免死锁。
    let mut map = text_refs().lock().map_err(|_| {
        errors::error(
            TAVILY_FETCH_ERROR_CODE,
            "网页正文引用存储被占用，请稍后重试。",
        )
    })?;
    let mut order = text_ref_order().lock().map_err(|_| {
        errors::error(
            TAVILY_FETCH_ERROR_CODE,
            "网页正文引用存储被占用，请稍后重试。",
        )
    })?;

    while map.len() >= TEXT_REF_CAPACITY {
        match order.pop_front() {
            Some(oldest) => {
                map.remove(&oldest);
            }
            None => break,
        }
    }

    map.insert(text_ref.clone(), text.to_string());
    order.push_back(text_ref.clone());

    Ok(text_ref)
}

// ============================================================
//  文本处理工具
// ============================================================

/// 当 Tavily 没返回 title 时，从清洗后的正文里兜底找 `<title>` 标签。
/// 注意：Tavily markdown 模式下基本不会命中，仅作 HTML fallback。
fn extract_html_title(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let after_start = lower[start..].find('>')? + start + 1;
    let end = lower[after_start..].find("</title>")? + after_start;
    let title = decode_basic_html_entities(text[after_start..end].trim());
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn normalize_excerpt_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut in_tag = false;
    for character in text.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    decode_basic_html_entities(&output)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 按字节裁剪，但回退到最近的 UTF-8 字符边界，避免 `from_utf8_lossy`
/// 因为切到多字节中段而引入 U+FFFD 替换字符（反而会让结果比 max_bytes 更长）。
fn clip_to_byte_limit(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_string()
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

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
//  Tavily 响应解析
// ============================================================

#[derive(Debug)]
struct TavilyFetchResult {
    title: Option<String>,
    raw_content: String,
}

fn extract_tavily_fetch_result(
    value: &Value,
    expected_url: &str,
) -> Result<TavilyFetchResult, String> {
    let Some(results) = value.get("results").and_then(Value::as_array) else {
        if let Some(error) = value
            .get("failedResults")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("error"))
            .and_then(Value::as_str)
        {
            return Err(errors::error(
                TAVILY_FETCH_ERROR_CODE,
                format!("官方 web_extract 失败：{error}"),
            ));
        }
        return Err(errors::error(
            TAVILY_FETCH_ERROR_CODE,
            "官方 web_extract 未返回结果。",
        ));
    };

    let result = results
        .iter()
        .find(|item| {
            item.get("url")
                .and_then(Value::as_str)
                .map(|url| url == expected_url)
                .unwrap_or(false)
        })
        .or_else(|| results.first());

    let Some(result) = result else {
        return Err(errors::error(
            TAVILY_FETCH_ERROR_CODE,
            "官方 web_extract 未返回目标 URL 的内容。",
        ));
    };

    let raw_content = result
        .get("rawContent")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if raw_content.is_empty() {
        return Err(errors::error(
            TAVILY_FETCH_ERROR_CODE,
            "官方 web_extract 返回了空内容。",
        ));
    }

    let title = result
        .get("title")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Ok(TavilyFetchResult { title, raw_content })
}

// ============================================================
//  Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::{
        clip_chars, clip_to_byte_limit, extract_html_title, extract_tavily_fetch_result,
        is_blocked_ip, normalize_excerpt_text, validate_fetch_url,
    };
    use serde_json::json;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    // --- validate_fetch_url ----------------------------------

    #[test]
    fn validate_fetch_url_rejects_local_and_private_targets() {
        for value in [
            "file:///C:/secret.txt",
            "ftp://example.com",
            "http://localhost:1420",
            "http://sub.localhost",
            "http://127.0.0.1:1420",
            "http://192.168.1.1",
            "http://10.0.0.1",
            "http://172.16.0.1",
            "http://169.254.169.254", // AWS metadata
            "http://0.0.0.0",
            "http://100.64.0.1", // CGNAT
            "http://224.0.0.1",  // multicast
            "http://255.255.255.255",
            "http://[::1]:8080",
            "http://[fe80::1]",
            "http://[fc00::1]",
            "http://[ff02::1]",          // IPv6 multicast
            "http://[::ffff:127.0.0.1]", // IPv4-mapped loopback
            "http://[::ffff:10.0.0.1]",  // IPv4-mapped private
        ] {
            assert!(
                validate_fetch_url(value).is_err(),
                "{value} should be blocked"
            );
        }
    }

    #[test]
    fn validate_fetch_url_accepts_public_http_targets() {
        assert!(validate_fetch_url("https://example.com/docs").is_ok());
        assert!(validate_fetch_url("http://example.com/docs").is_ok());
        assert!(validate_fetch_url("https://[2606:4700::1111]/").is_ok()); // 公网 IPv6
    }

    #[test]
    fn validate_fetch_url_rejects_missing_host() {
        // reqwest 对 "http:///path" 之类直接报解析错误，归到格式无效一类，这里仅验证不会 panic。
        assert!(validate_fetch_url("not a url").is_err());
    }

    // --- is_blocked_ip ---------------------------------------

    #[test]
    fn ipv4_mapped_ipv6_is_blocked_when_underlying_v4_is_blocked() {
        let mapped: Ipv6Addr = "::ffff:127.0.0.1".parse().unwrap();
        assert!(is_blocked_ip(IpAddr::V6(mapped)));

        let mapped_public: Ipv6Addr = "::ffff:8.8.8.8".parse().unwrap();
        assert!(!is_blocked_ip(IpAddr::V6(mapped_public)));
    }

    #[test]
    fn public_ipv4_is_not_blocked() {
        assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
    }

    // --- clip_to_byte_limit ----------------------------------

    #[test]
    fn clip_to_byte_limit_respects_utf8_boundary() {
        // "中" 占 3 字节，max=2 应该回退到 0 边界，结果为空字符串而非乱码。
        assert_eq!(clip_to_byte_limit("中文", 2), "");
        assert_eq!(clip_to_byte_limit("中文", 3), "中");
        assert_eq!(clip_to_byte_limit("中文", 4), "中");
        assert_eq!(clip_to_byte_limit("中文", 6), "中文");
        assert_eq!(clip_to_byte_limit("hello", 100), "hello");
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

    // --- normalize_excerpt_text ------------------------------

    #[test]
    fn normalize_excerpt_text_strips_tags_and_collapses_whitespace() {
        let s = normalize_excerpt_text("<h1>Hi   there</h1>\n  <p>A&amp;B&nbsp;C</p>");
        assert_eq!(s, "Hi there A&B C");
    }

    // --- extract_html_title ----------------------------------

    #[test]
    fn title_extraction_decodes_basic_entities() {
        let title = extract_html_title("<html><title>A &amp; B</title><body>ok</body></html>");
        assert_eq!(title.as_deref(), Some("A & B"));
    }

    #[test]
    fn title_extraction_returns_none_when_absent() {
        assert!(extract_html_title("# pure markdown\n\nbody").is_none());
    }

    // --- extract_tavily_fetch_result -------------------------

    #[test]
    fn tavily_fetch_result_prefers_matching_url_and_raw_content() {
        let value = json!({
            "results": [
                {
                    "url": "https://example.com/docs",
                    "title": "Example Docs",
                    "rawContent": "# Example Docs\n\nHello world"
                }
            ]
        });
        let result = extract_tavily_fetch_result(&value, "https://example.com/docs").unwrap();
        assert_eq!(result.title.as_deref(), Some("Example Docs"));
        assert_eq!(result.raw_content, "# Example Docs\n\nHello world");
    }

    #[test]
    fn tavily_fetch_result_falls_back_to_first_when_no_url_match() {
        let value = json!({
            "results": [
                {
                    "url": "https://example.com/docs/",
                    "title": "Example Docs",
                    "rawContent": "Hello"
                }
            ]
        });
        // 期望 URL 末尾无斜杠，Tavily 返回的有斜杠 — 应回落到第一条。
        let result = extract_tavily_fetch_result(&value, "https://example.com/docs").unwrap();
        assert_eq!(result.raw_content, "Hello");
    }

    #[test]
    fn tavily_fetch_result_surfaces_failed_results_error() {
        let value = json!({
            "failedResults": [
                { "url": "https://example.com", "error": "blocked by robots.txt" }
            ]
        });
        let err = extract_tavily_fetch_result(&value, "https://example.com").unwrap_err();
        assert!(err.contains("blocked by robots.txt"));
    }

    #[test]
    fn tavily_fetch_result_rejects_empty_raw_content() {
        let value = json!({
            "results": [
                { "url": "https://example.com", "rawContent": "" }
            ]
        });
        assert!(extract_tavily_fetch_result(&value, "https://example.com").is_err());
    }
}
