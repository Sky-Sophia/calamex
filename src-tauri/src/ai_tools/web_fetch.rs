use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::net::IpAddr;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use reqwest::header::{ACCEPT, ACCEPT_ENCODING};

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai::network_permission;
use crate::commands::contracts::{AiWebFetchInput, AiWebFetchPayload, AiWebFetchResultPayload};

const MAX_WEB_FETCH_BYTES: usize = 512 * 1024;
const WEB_FETCH_TIMEOUT_SECS: u64 = 15;
const WEB_EXCERPT_CHARS: usize = 600;

static WEB_TEXT_REFS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn text_refs() -> &'static Mutex<HashMap<String, String>> {
    WEB_TEXT_REFS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn fetch(input: AiWebFetchInput) -> Result<AiWebFetchPayload, String> {
    fetch_with_permission(input, true).await
}

pub async fn fetch_confirmed(input: AiWebFetchInput) -> Result<AiWebFetchPayload, String> {
    fetch_with_permission(input, false).await
}

async fn fetch_with_permission(
    input: AiWebFetchInput,
    require_runtime_permission: bool,
) -> Result<AiWebFetchPayload, String> {
    let url = validate_fetch_url(&input.url)?;
    if require_runtime_permission {
        if let Err(error) = network_permission::ensure_network_allowed() {
            audit::emit(AiAuditEventKind::AgentWebFetchFailed);
            return Err(error);
        }
    }

    let reason = input.reason.trim();

    if reason.is_empty() {
        return Err(errors::error(
            "AI_AGENT_WEB_FETCH_FAILED",
            "读取网页必须提供用途说明。",
        ));
    }

    let max_bytes = input.max_bytes.min(MAX_WEB_FETCH_BYTES).max(1);
    audit::emit(AiAuditEventKind::AgentWebFetchRequested);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(WEB_FETCH_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Xiaojianc-Agent/0.1")
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(|error| {
            errors::error(
                "AI_AGENT_WEB_FETCH_FAILED",
                format!("初始化网页读取客户端失败：{error}"),
            )
        })?;

    let response = client
        .get(url.clone())
        .header(ACCEPT, "text/html,application/xhtml+xml,text/plain,*/*")
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|error| {
            audit::emit(AiAuditEventKind::AgentWebFetchFailed);
            errors::error(
                "AI_AGENT_WEB_FETCH_FAILED",
                format!("网页读取失败：{error}"),
            )
        })?;

    if !response.status().is_success() {
        audit::emit(AiAuditEventKind::AgentWebFetchFailed);
        return Err(errors::error(
            "AI_AGENT_WEB_FETCH_FAILED",
            format!("网页读取失败：HTTP {}", response.status()),
        ));
    }

    let bytes = response.bytes().await.map_err(|error| {
        audit::emit(AiAuditEventKind::AgentWebFetchFailed);
        errors::error(
            "AI_AGENT_WEB_FETCH_FAILED",
            format!("读取网页正文失败：{error}"),
        )
    })?;

    let truncated = bytes.len() > max_bytes;
    let clipped = if truncated {
        &bytes[..max_bytes]
    } else {
        bytes.as_ref()
    };
    let text = String::from_utf8_lossy(clipped).to_string();
    let title = extract_title(&text).unwrap_or_else(|| url.to_string());
    let excerpt = clip_chars(&normalize_excerpt_text(&text), WEB_EXCERPT_CHARS);
    let text_ref = store_text_ref(&url.to_string(), &text)?;

    audit::emit(AiAuditEventKind::AgentWebFetchCompleted);

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

    let host_lower = host.to_lowercase();

    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return Err(errors::error(
            "AI_AGENT_WEB_SOURCE_BLOCKED",
            "web_fetch 禁止访问 localhost。",
        ));
    }

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
        IpAddr::V4(value) => {
            value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_unspecified()
                || value.octets()[0] == 0
        }
        IpAddr::V6(value) => {
            let first_segment = value.segments()[0];
            value.is_loopback()
                || value.is_unspecified()
                || (first_segment & 0xfe00) == 0xfc00
                || (first_segment & 0xffc0) == 0xfe80
        }
    }
}

fn store_text_ref(url: &str, text: &str) -> Result<String, String> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    text.len().hash(&mut hasher);
    chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_default()
        .hash(&mut hasher);
    let text_ref = format!("web-text:{:016x}", hasher.finish());

    let mut guard = text_refs().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_WEB_FETCH_FAILED",
            "网页正文引用存储被占用，请稍后重试。",
        )
    })?;

    guard.insert(text_ref.clone(), text.to_string());

    Ok(text_ref)
}

fn extract_title(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
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
    let mut output = String::new();
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
    use super::{extract_title, validate_fetch_url};

    #[test]
    fn validate_fetch_url_rejects_local_and_private_targets() {
        for value in [
            "file:///C:/secret.txt",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "http://192.168.1.1",
            "http://10.0.0.1",
            "http://172.16.0.1",
            "http://[::1]:8080",
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
    }

    #[test]
    fn title_extraction_decodes_basic_entities() {
        let title = extract_title("<html><title>A &amp; B</title><body>ok</body></html>");

        assert_eq!(title.as_deref(), Some("A & B"));
    }
}
