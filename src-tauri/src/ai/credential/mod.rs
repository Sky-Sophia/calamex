use super::errors;

const SERVICE_NAME: &str = "calamex.ai";

const SUPPORTED_PROVIDER_IDS: &[&str] = &[
    "openai",
    "anthropic",
    "deepseek",
    "google",
    "moonshotai",
    "alibaba",
    "zhipuai",
    "ollama",
];

pub struct CredentialStore;

impl CredentialStore {
    pub fn save(provider_id: &str, api_key: &str) -> Result<(), String> {
        let account = provider_account(provider_id)?;
        let trimmed_api_key = api_key.trim();

        if trimmed_api_key.is_empty() {
            return Err(errors::error("AI_PROVIDER_AUTH_FAILED", "请填写 API Key。"));
        }

        keyring::Entry::new(SERVICE_NAME, &account)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
            .set_password(trimmed_api_key)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))
    }

    pub fn get(provider_id: &str) -> Result<String, String> {
        let account = provider_account(provider_id)?;
        let password = keyring::Entry::new(SERVICE_NAME, &account)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
            .get_password()
            .map_err(|_| {
                errors::error(
                    "AI_PROVIDER_AUTH_FAILED",
                    "未找到当前厂商的 API Key，请在 AI 设置里填写并保存。",
                )
            })?;

        let trimmed = password.trim();
        if trimmed.is_empty() {
            return Err(errors::error(
                "AI_PROVIDER_AUTH_FAILED",
                "当前厂商的 API Key 为空，请在 AI 设置里重新填写并保存。",
            ));
        }

        Ok(trimmed.to_string())
    }

    pub fn has(provider_id: &str) -> bool {
        Self::get(provider_id).is_ok()
    }

    pub fn clear() -> Result<(), String> {
        for provider_id in SUPPORTED_PROVIDER_IDS {
            let account = provider_account(provider_id)?;
            let entry = keyring::Entry::new(SERVICE_NAME, &account)
                .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

            let _ = entry.delete_credential();
        }

        Ok(())
    }
}

pub fn supported_provider_ids() -> &'static [&'static str] {
    SUPPORTED_PROVIDER_IDS
}

fn provider_account(provider_id: &str) -> Result<String, String> {
    let normalized_provider_id = provider_id.trim();

    if !SUPPORTED_PROVIDER_IDS.contains(&normalized_provider_id) {
        return Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "当前厂商不支持保存凭证。",
        ));
    }

    Ok(format!("provider:{normalized_provider_id}"))
}

#[cfg(test)]
mod tests {
    use super::provider_account;

    #[test]
    fn provider_account_resolves_supported_vendor() {
        assert_eq!(provider_account("deepseek").unwrap(), "provider:deepseek");
        assert_eq!(provider_account(" openai ").unwrap(), "provider:openai");
    }

    #[test]
    fn provider_account_rejects_runtime_provider_and_unknown_vendor() {
        assert!(provider_account("mastra").is_err());
        assert!(provider_account("unknown-provider").is_err());
    }
}
