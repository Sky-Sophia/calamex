use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::ai::errors;

pub fn validate_public_http_url(value: &str) -> Result<reqwest::Url, String> {
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
    value.is_private()
        || value.is_loopback()
        || value.is_link_local()
        || value.is_unspecified()
        || value.is_multicast()
        || first == 0
        || first >= 240
        || first == 100 && (value.octets()[1] & 0xc0) == 64
}

fn is_blocked_ipv6(value: Ipv6Addr) -> bool {
    if let Some(mapped) = value.to_ipv4_mapped() {
        return is_blocked_ipv4(mapped);
    }
    let s0 = value.segments()[0];
    value.is_loopback()
        || value.is_unspecified()
        || (s0 & 0xfe00) == 0xfc00
        || (s0 & 0xffc0) == 0xfe80
        || (s0 & 0xff00) == 0xff00
}

#[cfg(test)]
mod tests {
    use super::validate_public_http_url;

    #[test]
    fn rejects_local_and_private_targets() {
        for value in [
            "file:///C:/secret.txt",
            "ftp://example.com",
            "http://localhost:1420",
            "http://sub.localhost",
            "http://127.0.0.1:1420",
            "http://192.168.1.1",
            "http://10.0.0.1",
            "http://172.16.0.1",
            "http://169.254.169.254",
            "http://0.0.0.0",
            "http://100.64.0.1",
            "http://224.0.0.1",
            "http://255.255.255.255",
            "http://[::1]:8080",
            "http://[fe80::1]",
            "http://[fc00::1]",
            "http://[ff02::1]",
            "http://[::ffff:127.0.0.1]",
            "http://[::ffff:10.0.0.1]",
        ] {
            assert!(validate_public_http_url(value).is_err(), "{value} should be blocked");
        }
    }

    #[test]
    fn accepts_public_http_targets() {
        assert!(validate_public_http_url("https://example.com/docs").is_ok());
        assert!(validate_public_http_url("http://example.com/docs").is_ok());
        assert!(validate_public_http_url("https://[2606:4700::1111]/").is_ok());
    }
}
