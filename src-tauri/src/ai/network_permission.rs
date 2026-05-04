use std::sync::{Mutex, OnceLock};

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::commands::contracts::{
    AiAgentNetworkPermissionPayload, AiAgentSetNetworkPermissionRequest,
};

static NETWORK_PERMISSION: OnceLock<Mutex<String>> = OnceLock::new();

fn network_permission_state() -> &'static Mutex<String> {
    NETWORK_PERMISSION.get_or_init(|| Mutex::new("ask".to_string()))
}

pub fn current_permission() -> Result<String, String> {
    let guard = network_permission_state().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "AI Agent 网络权限状态锁定失败，请稍后重试。",
        )
    })?;

    Ok(guard.clone())
}

pub fn set_network_permission(
    payload: AiAgentSetNetworkPermissionRequest,
) -> Result<AiAgentNetworkPermissionPayload, String> {
    let permission = payload.permission.trim();

    if !matches!(permission, "off" | "ask" | "allowed-this-run") {
        return Err(errors::error(
            "AI_AGENT_TOOL_NOT_ALLOWED",
            "AI Agent 网络权限值无效。",
        ));
    }

    let mut guard = network_permission_state().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "AI Agent 网络权限状态锁定失败，请稍后重试。",
        )
    })?;

    *guard = permission.to_string();
    audit::emit(AiAuditEventKind::AgentPermissionChanged);

    Ok(AiAgentNetworkPermissionPayload {
        permission: permission.to_string(),
    })
}

pub fn ensure_network_allowed() -> Result<(), String> {
    match current_permission()?.as_str() {
        "allowed-this-run" => Ok(()),
        "off" => Err(errors::error(
            "AI_AGENT_NETWORK_NOT_ALLOWED",
            "AI Agent 网络访问已关闭。",
        )),
        "ask" => Err(errors::error(
            "AI_AGENT_TOOL_CONFIRMATION_REQUIRED",
            "AI Agent 联网前需要用户授权。",
        )),
        _ => Err(errors::error(
            "AI_AGENT_NETWORK_NOT_ALLOWED",
            "AI Agent 网络权限状态无效。",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{ensure_network_allowed, set_network_permission};
    use crate::commands::contracts::AiAgentSetNetworkPermissionRequest;

    #[test]
    fn defaults_to_ask_and_requires_confirmation() {
        set_network_permission(AiAgentSetNetworkPermissionRequest {
            permission: "ask".to_string(),
        })
        .expect("reset permission to ask");

        let error = ensure_network_allowed().expect_err("ask should require confirmation");

        assert!(error.contains("AI_AGENT_TOOL_CONFIRMATION_REQUIRED"));
    }

    #[test]
    fn allows_network_after_explicit_approval() {
        set_network_permission(AiAgentSetNetworkPermissionRequest {
            permission: "allowed-this-run".to_string(),
        })
        .expect("set allowed permission");

        assert!(ensure_network_allowed().is_ok());

        set_network_permission(AiAgentSetNetworkPermissionRequest {
            permission: "ask".to_string(),
        })
        .expect("reset permission to ask");
    }
}