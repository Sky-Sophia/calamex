use super::*;

pub(super) struct AiProviderConnectionCandidate {
    pub(super) provider_type: String,
    pub(super) selected_model: Option<String>,
    pub(super) base_url: Option<String>,
    pub(super) api_key_for_test: Option<String>,
    pub(super) api_key_for_save: Option<String>,
    pub(super) inline_completion_enabled: bool,
    pub(super) chat_enabled: bool,
    pub(super) agent_enabled: bool,
}

pub fn get_config() -> AiConfigPayload {
    let config = config_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();

    to_payload(config)
}

pub fn save_config(
    role: Option<&str>,
    provider_type: &str,
    selected_model: Option<String>,
    base_url: Option<String>,
    inline_completion_enabled: bool,
    chat_enabled: bool,
    agent_enabled: bool,
) -> Result<AiConfigPayload, String> {
    let role = normalize_model_role(role)?;
    validate_provider(provider_type)?;

    let normalized_base_url = normalize_base_url(provider_type, base_url)?;
    let model = selected_model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| default_model(provider_type));

    let mut guard = config_state()
        .lock()
        .map_err(|_| errors::error("AI_PROVIDER_UNAVAILABLE", "AI 配置状态已损坏。"))?;

    match role {
        AiResolvedModelRole::Main => {
            let active_profile_id = resolve_retained_profile_id(
                &guard,
                AiResolvedModelRole::Main,
                provider_type,
                normalized_base_url.as_deref(),
            );
            guard.provider_type = provider_type.to_string();
            guard.selected_model = model;
            guard.base_url = normalized_base_url;
            guard.active_profile_id = active_profile_id;
            guard.inline_completion_enabled = inline_completion_enabled;
            guard.chat_enabled = chat_enabled;
            guard.agent_enabled = agent_enabled;
        }
        AiResolvedModelRole::Narrator => {
            let active_profile_id = resolve_retained_profile_id(
                &guard,
                AiResolvedModelRole::Narrator,
                provider_type,
                normalized_base_url.as_deref(),
            );
            guard.narrator.provider_type = provider_type.to_string();
            guard.narrator.selected_model = model;
            guard.narrator.base_url = normalized_base_url;
            guard.narrator.active_profile_id = active_profile_id;
        }
    }

    let payload = to_payload(guard.clone());

    persist_config(&guard)?;
    audit::emit(AiAuditEventKind::ConfigUpdated);

    Ok(payload)
}

pub(super) fn resolve_retained_profile_id(
    config: &AiRuntimeConfig,
    role: AiResolvedModelRole,
    provider_type: &str,
    base_url: Option<&str>,
) -> Option<String> {
    let active_profile_id = match role {
        AiResolvedModelRole::Main => config.active_profile_id.as_deref(),
        AiResolvedModelRole::Narrator => config.narrator.active_profile_id.as_deref(),
    }?;
    let active_profile = config
        .profiles
        .iter()
        .find(|profile| profile.id == active_profile_id)?;

    if active_profile.role != role.as_str()
        || active_profile.provider_type != provider_type
        || active_profile.base_url.as_deref() != base_url
        || !CredentialStore::has_profile_secret(&active_profile.id)
    {
        return None;
    }

    Some(active_profile.id.clone())
}

pub fn save_credentials(
    role: Option<&str>,
    provider_type: &str,
    api_key: &str,
) -> Result<AiConfigPayload, String> {
    let role = normalize_model_role(role)?;
    validate_provider(provider_type)?;

    let trimmed = api_key.trim();

    if trimmed.is_empty() {
        return Err(errors::error("AI_PROVIDER_AUTH_FAILED", "请填写 API Key。"));
    }

    let active_profile_id = current_config().map(|config| match role {
        AiResolvedModelRole::Main => (config.provider_type == provider_type)
            .then_some(config.active_profile_id)
            .flatten(),
        AiResolvedModelRole::Narrator => (config.narrator.provider_type == provider_type)
            .then_some(config.narrator.active_profile_id)
            .flatten(),
    })?;

    CredentialStore::save_for_role(provider_type, role.credential_role(), trimmed)?;

    if let Some(profile_id) = active_profile_id {
        CredentialStore::save_profile_secret(&profile_id, trimmed)?;
    }

    audit::emit(AiAuditEventKind::ConfigUpdated);

    Ok(get_config())
}

pub fn clear_credentials() -> Result<(), String> {
    let profile_ids = current_config()
        .map(|config| {
            config
                .profiles
                .into_iter()
                .map(|profile| profile.id)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    CredentialStore::clear()?;

    for profile_id in profile_ids {
        CredentialStore::delete_profile_secret(&profile_id)?;
    }

    Ok(())
}

pub fn list_provider_profiles() -> Result<Vec<AiProviderProfilePayload>, String> {
    let config = current_config()?;

    Ok(config
        .profiles
        .iter()
        .cloned()
        .map(|profile| profile_to_payload(profile, &config))
        .collect())
}

pub fn get_provider_profile_detail(
    payload: AiProviderProfileSwitchRequest,
) -> Result<AiProviderProfileDetailPayload, String> {
    let config = current_config()?;
    let profile = config
        .profiles
        .iter()
        .find(|item| item.id == payload.profile_id)
        .cloned()
        .ok_or_else(|| errors::error("AI_PROVIDER_NOT_CONFIGURED", "未找到该 AI 配置记录。"))?;
    let api_key = CredentialStore::get_profile_secret(&profile.id).ok();

    Ok(AiProviderProfileDetailPayload {
        profile: profile_to_payload(profile, &config),
        api_key,
    })
}

pub fn switch_provider_profile(
    payload: AiProviderProfileSwitchRequest,
) -> Result<AiConfigPayload, String> {
    let mut guard = config_state()
        .lock()
        .map_err(|_| errors::error("AI_PROVIDER_UNAVAILABLE", "AI 配置状态已损坏。"))?;
    let now = chrono::Utc::now().to_rfc3339();
    let profile_index = guard
        .profiles
        .iter()
        .position(|profile| profile.id == payload.profile_id)
        .ok_or_else(|| errors::error("AI_PROVIDER_NOT_CONFIGURED", "未找到该 AI 配置记录。"))?;
    let profile = guard.profiles[profile_index].clone();
    let profile_role = normalize_model_role(Some(&profile.role))?;

    if !CredentialStore::has_profile_secret(&profile.id) {
        return Err(errors::error(
            "AI_PROVIDER_AUTH_FAILED",
            "该配置记录缺少 API Key，请重新连接后保存。",
        ));
    }

    match profile_role {
        AiResolvedModelRole::Main => {
            guard.provider_type = profile.provider_type.clone();
            guard.selected_model = profile.selected_model.clone();
            guard.base_url = profile.base_url.clone();
            guard.inline_completion_enabled = profile.inline_completion_enabled;
            guard.chat_enabled = profile.chat_enabled;
            guard.agent_enabled = profile.agent_enabled;
            guard.active_profile_id = Some(profile.id.clone());
        }
        AiResolvedModelRole::Narrator => {
            guard.narrator.provider_type = profile.provider_type.clone();
            guard.narrator.selected_model = profile.selected_model.clone();
            guard.narrator.base_url = profile.base_url.clone();
            guard.narrator.active_profile_id = Some(profile.id.clone());
        }
    }
    guard.profiles[profile_index].last_used_at = Some(now.clone());
    guard.profiles[profile_index].updated_at = now;

    let payload = to_payload(guard.clone());
    persist_config(&guard)?;
    audit::emit(AiAuditEventKind::ConfigUpdated);

    Ok(payload)
}

pub(super) fn build_provider_connection_candidate(
    role: AiResolvedModelRole,
    provider_type: &str,
    selected_model: Option<String>,
    base_url: Option<String>,
    inline_completion_enabled: bool,
    chat_enabled: bool,
    agent_enabled: bool,
    api_key: Option<&str>,
) -> Result<AiProviderConnectionCandidate, String> {
    validate_provider(provider_type)?;

    let normalized_base_url = normalize_base_url(provider_type, base_url)?;
    let model = selected_model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| default_model(provider_type));

    let provided_api_key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let api_key_for_test = match provided_api_key.clone() {
        Some(value) => value,
        None => get_saved_api_key_for_candidate(
            role,
            provider_type,
            model.as_deref(),
            normalized_base_url.as_deref(),
        )?,
    };

    if api_key_for_test.trim().is_empty() {
        return Err(errors::error("AI_PROVIDER_AUTH_FAILED", "请填写 API Key。"));
    }

    Ok(AiProviderConnectionCandidate {
        provider_type: provider_type.to_string(),
        selected_model: model,
        base_url: normalized_base_url,
        api_key_for_test: Some(api_key_for_test),
        api_key_for_save: provided_api_key,
        inline_completion_enabled,
        chat_enabled,
        agent_enabled,
    })
}

pub(super) fn save_connected_profile(
    role: AiResolvedModelRole,
    provider_type: String,
    selected_model: Option<String>,
    base_url: Option<String>,
    inline_completion_enabled: bool,
    chat_enabled: bool,
    agent_enabled: bool,
    api_key: Option<&str>,
) -> Result<AiConfigPayload, String> {
    validate_provider(&provider_type)?;

    let mut guard = config_state()
        .lock()
        .map_err(|_| errors::error("AI_PROVIDER_UNAVAILABLE", "AI 配置状态已损坏。"))?;
    let now = chrono::Utc::now().to_rfc3339();
    let profile_index = find_matching_profile_index(
        &guard.profiles,
        role,
        &provider_type,
        selected_model.as_deref(),
        base_url.as_deref(),
    );
    let profile_id = profile_index
        .and_then(|index| guard.profiles.get(index).map(|profile| profile.id.clone()))
        .unwrap_or_else(generate_profile_id);
    let profile_name = build_profile_name(selected_model.as_deref(), base_url.as_deref());

    if let Some(api_key_to_save) = api_key {
        CredentialStore::save_profile_secret(&profile_id, api_key_to_save)?;
    }

    match profile_index {
        Some(index) => {
            let profile = &mut guard.profiles[index];
            profile.name = profile_name;
            profile.role = role.as_str().to_string();
            profile.provider_type = provider_type.clone();
            profile.selected_model = selected_model.clone();
            profile.base_url = base_url.clone();
            profile.inline_completion_enabled = inline_completion_enabled;
            profile.chat_enabled = chat_enabled;
            profile.agent_enabled = agent_enabled;
            profile.updated_at = now.clone();
            profile.last_used_at = Some(now.clone());
        }
        None => guard.profiles.push(AiProviderProfile {
            id: profile_id.clone(),
            role: role.as_str().to_string(),
            name: profile_name,
            provider_type: provider_type.clone(),
            selected_model: selected_model.clone(),
            base_url: base_url.clone(),
            inline_completion_enabled,
            chat_enabled,
            agent_enabled,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_used_at: Some(now.clone()),
        }),
    }

    match role {
        AiResolvedModelRole::Main => {
            guard.provider_type = provider_type;
            guard.selected_model = selected_model;
            guard.base_url = base_url;
            guard.inline_completion_enabled = inline_completion_enabled;
            guard.chat_enabled = chat_enabled;
            guard.agent_enabled = agent_enabled;
            guard.active_profile_id = Some(profile_id);
        }
        AiResolvedModelRole::Narrator => {
            guard.narrator.provider_type = provider_type;
            guard.narrator.selected_model = selected_model;
            guard.narrator.base_url = base_url;
            guard.narrator.active_profile_id = Some(profile_id);
        }
    }

    let payload = to_payload(guard.clone());
    persist_config(&guard)?;
    audit::emit(AiAuditEventKind::ConfigUpdated);

    Ok(payload)
}

pub(super) fn save_connected_narrator(
    provider_type: String,
    selected_model: Option<String>,
    base_url: Option<String>,
    api_key: Option<&str>,
) -> Result<AiConfigPayload, String> {
    save_connected_profile(
        AiResolvedModelRole::Narrator,
        provider_type,
        selected_model,
        base_url,
        false,
        false,
        false,
        api_key,
    )
}
