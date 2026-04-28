const SECRET_MARKERS: &[&str] = &[
    "api_key",
    "apikey",
    "api-key",
    "authorization",
    "bearer ",
    "sk-",
    "access_token",
    "refresh_token",
    "token=",
    "token:",
    "\"token\"",
    "secret",
    "password",
    "private key",
    "-----begin",
    ".env",
];

#[derive(Debug, Clone)]
pub struct RedactionResult {
    pub text: String,
    pub blocked: bool,
}

pub fn redact_text(value: &str) -> RedactionResult {
    let lower = value.to_lowercase();
    let blocked = SECRET_MARKERS.iter().any(|marker| lower.contains(marker));
    if !blocked {
        return RedactionResult {
            text: value.to_string(),
            blocked: false,
        };
    }

    let text = value
        .lines()
        .map(|line| {
            let line_lower = line.to_lowercase();
            if SECRET_MARKERS
                .iter()
                .any(|marker| line_lower.contains(marker))
            {
                "[已脱敏：疑似敏感内容]".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    RedactionResult { text, blocked }
}

#[cfg(test)]
mod tests {
    use super::redact_text;

    #[test]
    fn redacts_api_key_lines() {
        let result = redact_text("ok\napi_key=sk-test-secret-value\nnext");

        assert!(result.blocked);
        assert!(result.text.contains("[已脱敏：疑似敏感内容]"));
        assert!(!result.text.contains("sk-test-secret-value"));
        assert!(result.text.contains("ok"));
        assert!(result.text.contains("next"));
    }

    #[test]
    fn redacts_authorization_bearer_lines() {
        let result = redact_text("Authorization: Bearer token-value-1234567890");

        assert!(result.blocked);
        assert!(!result.text.contains("token-value-1234567890"));
    }
}
