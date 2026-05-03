use super::errors;

const SERVICE_NAME: &str = "calamex.ai";

const LITELLM_USER: &str = "litellm";
const LITELLM_NARRATOR_USER: &str = "litellm:narrator";

const PROVIDER_ACCOUNTS: &[(&str, &str)] = &[("litellm", LITELLM_USER)];
const PROVIDER_ROLE_ACCOUNTS: &[(&str, &str, &str)] =
    &[("litellm", "narrator", LITELLM_NARRATOR_USER)];

const LEGACY_PROVIDER_ACCOUNTS: &[&str] = &[
    "openai-compatible",
    "openai",
    "deepseek",
    "moonshot",
    "dashscope",
    "zhipu",
    "siliconflow",
];

pub struct CredentialStore;

impl CredentialStore {
    pub fn save_for_role(provider_type: &str, role: &str, api_key: &str) -> Result<(), String> {
        let account = provider_role_account(provider_type, role)?;
        Self::save_account(account, api_key)
    }

    fn save_account(account: &str, api_key: &str) -> Result<(), String> {
        let trimmed_api_key = api_key.trim();

        if trimmed_api_key.is_empty() {
            return Err(errors::error("AI_PROVIDER_AUTH_FAILED", "请填写 API Key。"));
        }

        keyring::Entry::new(SERVICE_NAME, account)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
            .set_password(trimmed_api_key)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))
    }

    pub fn get(provider_type: &str) -> Result<String, String> {
        let account = provider_account(provider_type)?;
        Self::get_account(account)
    }

    pub fn get_for_role(provider_type: &str, role: &str) -> Result<String, String> {
        let account = provider_role_account(provider_type, role)?;
        Self::get_account(account)
    }

    fn get_account(account: &str) -> Result<String, String> {
        let password = keyring::Entry::new(SERVICE_NAME, account)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
            .get_password()
            .map_err(|_| {
                errors::error(
                    "AI_PROVIDER_AUTH_FAILED",
                    "未找到当前 Provider 的 API Key，请在 AI 设置里填写并保存。",
                )
            })?;

        let trimmed = password.trim();

        if trimmed.is_empty() {
            return Err(errors::error(
                "AI_PROVIDER_AUTH_FAILED",
                "当前 Provider 的 API Key 为空，请在 AI 设置里重新填写并保存。",
            ));
        }

        Ok(trimmed.to_string())
    }

    pub fn save_profile_secret(profile_id: &str, api_key: &str) -> Result<(), String> {
        let account = profile_account(profile_id)?;
        let trimmed_api_key = api_key.trim();

        if trimmed_api_key.is_empty() {
            return Err(errors::error("AI_PROVIDER_AUTH_FAILED", "请填写 API Key。"));
        }

        keyring::Entry::new(SERVICE_NAME, &account)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
            .set_password(trimmed_api_key)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))
    }

    pub fn get_profile_secret(profile_id: &str) -> Result<String, String> {
        let account = profile_account(profile_id)?;

        let password = keyring::Entry::new(SERVICE_NAME, &account)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
            .get_password()
            .map_err(|_| {
                errors::error(
                    "AI_PROVIDER_AUTH_FAILED",
                    "未找到当前配置记录的 API Key，请重新连接并保存。",
                )
            })?;

        let trimmed = password.trim();

        if trimmed.is_empty() {
            return Err(errors::error(
                "AI_PROVIDER_AUTH_FAILED",
                "当前配置记录的 API Key 为空，请重新连接并保存。",
            ));
        }

        Ok(trimmed.to_string())
    }

    pub fn has_profile_secret(profile_id: &str) -> bool {
        Self::get_profile_secret(profile_id).is_ok()
    }

    pub fn delete_profile_secret(profile_id: &str) -> Result<(), String> {
        let account = profile_account(profile_id)?;

        let entry = keyring::Entry::new(SERVICE_NAME, &account)
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

        let _ = entry.delete_credential();

        Ok(())
    }

    pub fn clear() -> Result<(), String> {
        for (_, account) in PROVIDER_ACCOUNTS {
            let entry = keyring::Entry::new(SERVICE_NAME, account)
                .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

            let _ = entry.delete_credential();
        }

        for (_, _, account) in PROVIDER_ROLE_ACCOUNTS {
            let entry = keyring::Entry::new(SERVICE_NAME, account)
                .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

            let _ = entry.delete_credential();
        }

        for account in LEGACY_PROVIDER_ACCOUNTS {
            let entry = keyring::Entry::new(SERVICE_NAME, account)
                .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

            let _ = entry.delete_credential();
        }

        Ok(())
    }

    pub fn has_provider_secret(provider_type: &str) -> bool {
        Self::get(provider_type).is_ok()
    }

    pub fn has_provider_secret_for_role(provider_type: &str, role: &str) -> bool {
        Self::get_for_role(provider_type, role).is_ok()
    }
}

fn provider_account(provider_type: &str) -> Result<&'static str, String> {
    let normalized_provider_type = provider_type.trim();

    PROVIDER_ACCOUNTS
        .iter()
        .find_map(|(candidate_provider_type, account)| {
            (*candidate_provider_type == normalized_provider_type).then_some(*account)
        })
        .ok_or_else(|| {
            errors::error(
                "AI_PROVIDER_NOT_CONFIGURED",
                "当前 Provider 不需要或不支持保存凭证。",
            )
        })
}

fn provider_role_account(provider_type: &str, role: &str) -> Result<&'static str, String> {
    let normalized_role = role.trim();

    if normalized_role.is_empty() || normalized_role == "main" {
        return provider_account(provider_type);
    }

    let normalized_provider_type = provider_type.trim();

    PROVIDER_ROLE_ACCOUNTS
        .iter()
        .find_map(|(candidate_provider_type, candidate_role, account)| {
            (*candidate_provider_type == normalized_provider_type
                && *candidate_role == normalized_role)
                .then_some(*account)
        })
        .ok_or_else(|| {
            errors::error(
                "AI_PROVIDER_NOT_CONFIGURED",
                "当前 Provider 不支持该模型用途的凭证。",
            )
        })
}

fn profile_account(profile_id: &str) -> Result<String, String> {
    let normalized_profile_id = profile_id.trim();

    if normalized_profile_id.is_empty()
        || !normalized_profile_id
            .chars()
            .all(|item| item.is_ascii_alphanumeric() || item == '-' || item == '_')
    {
        return Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "AI 配置记录 ID 无效。",
        ));
    }

    Ok(format!("profile:{normalized_profile_id}"))
}

#[cfg(test)]
mod tests {
    use super::{
        profile_account, provider_account, provider_role_account, LITELLM_NARRATOR_USER,
        LITELLM_USER,
    };

    #[test]
    fn provider_account_resolves_supported_providers() {
        assert_eq!(provider_account("litellm").unwrap(), LITELLM_USER);
    }

    #[test]
    fn provider_account_trims_provider_type() {
        assert_eq!(provider_account(" litellm ").unwrap(), LITELLM_USER);
    }

    #[test]
    fn provider_account_rejects_legacy_providers() {
        assert!(provider_account("openai").is_err());
        assert!(provider_account("mock").is_err());
    }

    #[test]
    fn provider_account_rejects_unknown_provider() {
        assert!(provider_account("unknown-provider").is_err());
    }

    #[test]
    fn provider_role_account_keeps_main_and_narrator_separate() {
        assert_eq!(
            provider_role_account("litellm", "main").unwrap(),
            LITELLM_USER
        );
        assert_eq!(
            provider_role_account("litellm", "narrator").unwrap(),
            LITELLM_NARRATOR_USER
        );
    }

    #[test]
    fn profile_account_accepts_generated_ids() {
        assert_eq!(
            profile_account("ai-profile-123_abc").unwrap(),
            "profile:ai-profile-123_abc"
        );
    }

    #[test]
    fn profile_account_rejects_unsafe_ids() {
        assert!(profile_account("../token").is_err());
        assert!(profile_account("profile:abc").is_err());
    }
}
