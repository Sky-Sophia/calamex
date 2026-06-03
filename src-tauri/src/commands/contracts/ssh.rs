use serde::{Deserialize, Serialize};
use specta::Type;

use super::secret::SecretString;

// ============================================================================
// SSH
// ============================================================================
//
// 以下 *Request 共享一组连接字段（host/port/username/auth_mode/identity_path），
// 出于"零破坏性"约束本版未抽 SshCredentials + #[serde(flatten)]，未来若决定
// 重构，是 wire-compatible 的纯 Rust 内部改动。
//
// password 统一包裹为 `Option<SecretString>`：wire 层因 `#[serde(transparent)]`
// 与裸字符串完全兼容，但 Debug 输出会被遮蔽，且析构时清零，避免明文随日志或
// 内存转储泄露。SecretString 自身派生 `Type`（`#[serde(transparent)]` 包裹
// String），故 password 字段在前端类型中表现为 `string`。
//
// 本版所有 *Request / *Payload 均派生 `specta::Type`，供 tauri-specta 生成前端
// 绑定；u64 字段以 `#[specta(type = u32)]` 覆盖（specta 禁止导出 64 位整型，
// TS 侧统一为 number）。注意：该覆盖只影响生成的 TS 类型标注，不改变 serde
// 序列化——后端仍按 u64 序列化，即使字节数超过 u32 上限，JS 端也会原样收到一个
// 普通 number（安全整数范围内），故 TS 侧用 number 标注无运行期风险，同时避免
// f64 覆盖在生成类型中带来的 `number | null`。
//
// 注意：identity_path 在某些上下文下可能算敏感信息（包含本地用户名路径），
// 当前保留 Debug；若要进一步收紧可换成 `SecretString` 或自定义 Debug。

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionTestRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    /// 已知值："password" | "key" | "agent"。
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionTestPayload {
    pub(crate) ok: bool,
    /// 已知值："ok" | "auth-failed" | "host-unreachable" | "timeout" | …。
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPasswordSaveRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) password: SecretString,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPasswordGetRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPasswordStatusPayload {
    pub(crate) has_password: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPasswordPayload {
    pub(crate) password: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryListRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) path: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryEntryPayload {
    pub(crate) name: String,
    pub(crate) path: String,
    /// 已知值："file" | "directory" | "symlink"。
    pub(crate) kind: String,
    #[specta(type = u32)]
    pub(crate) size: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryListPayload {
    pub(crate) path: String,
    pub(crate) entries: Vec<SshDirectoryEntryPayload>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileDownloadRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) remote_path: String,
    pub(crate) local_path: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileDownloadPayload {
    pub(crate) remote_path: String,
    pub(crate) local_path: String,
    #[specta(type = u32)]
    pub(crate) byte_size: u64,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileUploadRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) local_path: String,
    pub(crate) remote_directory: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileUploadPayload {
    pub(crate) local_path: String,
    pub(crate) remote_path: String,
    #[specta(type = u32)]
    pub(crate) byte_size: u64,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPathDeleteRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) remote_path: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPathDeletePayload {
    pub(crate) remote_path: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPathRenameRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) remote_path: String,
    pub(crate) new_name: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshPathRenamePayload {
    pub(crate) old_path: String,
    pub(crate) new_path: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryCreateRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) remote_directory: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryCreatePayload {
    pub(crate) remote_path: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileReadRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) remote_path: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileReadPayload {
    pub(crate) remote_path: String,
    pub(crate) content: String,
    #[specta(type = u32)]
    pub(crate) byte_size: u64,
    pub(crate) encoding: String,
    #[specta(type = u32)]
    pub(crate) line_count: u64,
    pub(crate) line_ending: String,
    pub(crate) permission: String,
    pub(crate) owner: String,
    pub(crate) modified_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileWriteRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) password: Option<SecretString>,
    pub(crate) remote_path: String,
    pub(crate) content: String,
    pub(crate) encoding: String,
    pub(crate) line_ending: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshFileWritePayload {
    pub(crate) remote_path: String,
    #[specta(type = u32)]
    pub(crate) byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHostPayload {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) username: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) identity_path: Option<String>,
    pub(crate) last_used_label: String,
}
