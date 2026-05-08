use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::CONTENT_TYPE;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::http::{Request, Response, StatusCode};
use tauri::Manager;
use tokio::fs;
use tokio::net::lookup_host;

use crate::ai_tools::web_fetch::validate_fetch_url;

const CACHE_DIR_NAME: &str = "favicons";
const CACHE_TTL_SUCCESS_SECS: i64 = 30 * 24 * 60 * 60;
const CACHE_TTL_FAILED_SECS: i64 = 24 * 60 * 60;
const REQUEST_TIMEOUT_SECS: u64 = 3;
const MAX_ICON_BYTES: usize = 256 * 1024;
const MAX_HTML_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FaviconCacheMeta {
    status: String,
    expires_at: i64,
    content_type: Option<String>,
}

#[derive(Debug)]
enum CacheLookup {
    Hit {
        bytes: Vec<u8>,
        content_type: String,
    },
    Negative,
    Miss,
}

pub async fn handle_protocol_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Some(host) = parse_favicon_host(&request) else {
        return text_response(StatusCode::BAD_REQUEST, "invalid favicon host");
    };

    let cache_root = match resolve_cache_root(app) {
        Ok(path) => path,
        Err(_) => {
            return text_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to resolve favicon cache path",
            );
        }
    };

    match read_cache_entry(&cache_root, &host).await {
        CacheLookup::Hit {
            bytes,
            content_type,
        } => {
            return binary_response(StatusCode::OK, &content_type, bytes);
        }
        CacheLookup::Negative => {
            return text_response(StatusCode::NOT_FOUND, "favicon not found");
        }
        CacheLookup::Miss => {}
    }

    let fetch_result = fetch_favicon_bytes(&host).await;

    match fetch_result {
        Ok((bytes, content_type)) => {
            let _ = write_success_cache_entry(&cache_root, &host, &bytes, &content_type).await;
            binary_response(StatusCode::OK, &content_type, bytes)
        }
        Err(_) => {
            let _ = write_failure_cache_entry(&cache_root, &host).await;
            text_response(StatusCode::NOT_FOUND, "favicon not found")
        }
    }
}

fn parse_favicon_host(request: &Request<Vec<u8>>) -> Option<String> {
    let authority = request.uri().authority().map(|value| value.as_str()).unwrap_or_default();

    if !authority.is_empty() && !authority.eq_ignore_ascii_case("localhost") {
        return None;
    }

    let raw_host = request.uri().path().trim_matches('/').trim().to_lowercase();

    if raw_host.is_empty() || raw_host.len() > 253 {
        return None;
    }

    if raw_host.contains('/') || raw_host.contains(':') {
        return None;
    }

    if !raw_host
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '.')
    {
        return None;
    }

    Some(raw_host)
}

fn resolve_cache_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;

    Ok(base_dir.join(CACHE_DIR_NAME))
}

fn cache_file_stem(host: &str) -> String {
    host
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '.' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn cache_meta_path(cache_root: &Path, host: &str) -> PathBuf {
    cache_root.join(format!("{}.json", cache_file_stem(host)))
}

fn cache_icon_path(cache_root: &Path, host: &str) -> PathBuf {
    cache_root.join(format!("{}.bin", cache_file_stem(host)))
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

async fn ensure_cache_dir(cache_root: &Path) -> Result<(), String> {
    fs::create_dir_all(cache_root)
        .await
        .map_err(|error| format!("failed to create favicon cache dir: {error}"))
}

async fn read_cache_entry(cache_root: &Path, host: &str) -> CacheLookup {
    let meta_path = cache_meta_path(cache_root, host);
    let icon_path = cache_icon_path(cache_root, host);

    let raw_meta = match fs::read(&meta_path).await {
        Ok(content) => content,
        Err(_) => return CacheLookup::Miss,
    };

    let meta: FaviconCacheMeta = match serde_json::from_slice(&raw_meta) {
        Ok(value) => value,
        Err(_) => return CacheLookup::Miss,
    };

    if meta.expires_at <= now_unix_secs() {
        let _ = fs::remove_file(&meta_path).await;
        let _ = fs::remove_file(&icon_path).await;
        return CacheLookup::Miss;
    }

    if meta.status == "failed" {
        return CacheLookup::Negative;
    }

    let bytes = match fs::read(&icon_path).await {
        Ok(content) => content,
        Err(_) => return CacheLookup::Miss,
    };

    let content_type = meta
        .content_type
        .unwrap_or_else(|| "image/x-icon".to_string());

    CacheLookup::Hit {
        bytes,
        content_type,
    }
}

async fn write_success_cache_entry(
    cache_root: &Path,
    host: &str,
    bytes: &[u8],
    content_type: &str,
) -> Result<(), String> {
    ensure_cache_dir(cache_root).await?;

    let meta = FaviconCacheMeta {
        status: "ok".to_string(),
        expires_at: now_unix_secs() + CACHE_TTL_SUCCESS_SECS,
        content_type: Some(content_type.to_string()),
    };

    let icon_path = cache_icon_path(cache_root, host);
    let meta_path = cache_meta_path(cache_root, host);

    fs::write(&icon_path, bytes)
        .await
        .map_err(|error| format!("failed to write favicon cache binary: {error}"))?;

    let meta_bytes = serde_json::to_vec(&meta)
        .map_err(|error| format!("failed to encode favicon cache meta: {error}"))?;

    fs::write(&meta_path, meta_bytes)
        .await
        .map_err(|error| format!("failed to write favicon cache meta: {error}"))?;

    Ok(())
}

async fn write_failure_cache_entry(cache_root: &Path, host: &str) -> Result<(), String> {
    ensure_cache_dir(cache_root).await?;

    let icon_path = cache_icon_path(cache_root, host);
    let meta_path = cache_meta_path(cache_root, host);

    let meta = FaviconCacheMeta {
        status: "failed".to_string(),
        expires_at: now_unix_secs() + CACHE_TTL_FAILED_SECS,
        content_type: None,
    };

    let meta_bytes = serde_json::to_vec(&meta)
        .map_err(|error| format!("failed to encode favicon negative cache meta: {error}"))?;

    let _ = fs::remove_file(&icon_path).await;

    fs::write(&meta_path, meta_bytes)
        .await
        .map_err(|error| format!("failed to write favicon negative cache meta: {error}"))?;

    Ok(())
}

async fn fetch_favicon_bytes(host: &str) -> Result<(Vec<u8>, String), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Calamex-Favicon-Proxy/0.1")
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(|error| format!("failed to build favicon http client: {error}"))?;

    let mut candidates: Vec<String> = Vec::with_capacity(4);

    if let Some(icon_url) = resolve_html_icon_url(&client, host).await {
        candidates.push(icon_url.to_string());
    }

    candidates.push(format!(
        "https://www.google.com/s2/favicons?domain={host}&sz=64"
    ));
    candidates.push(format!("https://icons.duckduckgo.com/ip3/{host}.ico"));
    candidates.push(format!("https://{host}/favicon.ico"));

    for candidate in candidates {
        if let Ok((bytes, content_type)) = try_fetch_icon(&client, &candidate).await {
            return Ok((bytes, content_type));
        }
    }

    Err("favicon not found".to_string())
}

async fn resolve_html_icon_url(client: &reqwest::Client, host: &str) -> Option<Url> {
    let base = Url::parse(&format!("https://{host}/")).ok()?;

    if ensure_url_host_is_public(&base).await.is_err() {
        return None;
    }

    let response = client
        .get(base.clone())
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let body = response.text().await.ok()?;
    let clipped = clip_utf8_text(&body, MAX_HTML_BYTES);
    let href = find_html_icon_href(&clipped)?;

    base.join(&href).ok()
}

fn clip_utf8_text(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }

    let mut output = String::with_capacity(limit);

    for character in value.chars() {
        if output.len() + character.len_utf8() > limit {
            break;
        }

        output.push(character);
    }

    output
}

fn find_html_icon_href(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut search_index = 0usize;

    while let Some(link_index) = lower[search_index..].find("<link") {
        let start = search_index + link_index;
        let end = lower[start..].find('>').map(|offset| start + offset)?;
        let tag = &html[start..=end];
        let tag_lower = &lower[start..=end];

        if let Some(rel_value) = extract_html_attribute(tag, tag_lower, "rel") {
            if rel_value.to_lowercase().contains("icon") {
                if let Some(href) = extract_html_attribute(tag, tag_lower, "href") {
                    if !href.trim().is_empty() {
                        return Some(href.trim().to_string());
                    }
                }
            }
        }

        search_index = end + 1;
    }

    None
}

fn extract_html_attribute(tag: &str, tag_lower: &str, attribute: &str) -> Option<String> {
    let key = format!("{attribute}=");
    let start = tag_lower.find(&key)? + key.len();
    let rest = &tag[start..];
    let trimmed = rest.trim_start();

    if let Some(stripped) = trimmed.strip_prefix('"') {
        let end = stripped.find('"')?;
        return Some(stripped[..end].to_string());
    }

    if let Some(stripped) = trimmed.strip_prefix('\'') {
        let end = stripped.find('\'')?;
        return Some(stripped[..end].to_string());
    }

    let end = trimmed
        .find(|character: char| character.is_whitespace() || character == '>')
        .unwrap_or(trimmed.len());

    Some(trimmed[..end].to_string())
}

async fn try_fetch_icon(
    client: &reqwest::Client,
    candidate_url: &str,
) -> Result<(Vec<u8>, String), String> {
    let url = validate_fetch_url(candidate_url)?;
    ensure_url_host_is_public(&url).await?;

    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "image/*,*/*;q=0.8")
        .send()
        .await
        .map_err(|error| format!("favicon fetch request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("favicon fetch status is {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/x-icon")
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read favicon bytes: {error}"))?;

    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return Err("favicon payload exceeds limit".to_string());
    }

    Ok((bytes.to_vec(), content_type))
}

async fn ensure_url_host_is_public(url: &Url) -> Result<(), String> {
    let Some(host) = url.host_str() else {
        return Err("favicon URL missing host".to_string());
    };

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("favicon host resolves to blocked IP".to_string());
        }

        return Ok(());
    }

    if host.eq_ignore_ascii_case("localhost") || host.to_lowercase().ends_with(".localhost") {
        return Err("localhost is blocked for favicon proxy".to_string());
    }

    let mut resolved = false;
    let addresses = lookup_host((host, 443))
        .await
        .map_err(|error| format!("failed to resolve favicon host: {error}"))?;

    for address in addresses {
        resolved = true;

        if is_blocked_ip(address.ip()) {
            return Err("favicon host resolved to blocked IP".to_string());
        }
    }

    if !resolved {
        return Err("favicon host did not resolve to public addresses".to_string());
    }

    Ok(())
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

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn binary_response(status: StatusCode, content_type: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Cache-Control", "public, max-age=2592000")
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}
