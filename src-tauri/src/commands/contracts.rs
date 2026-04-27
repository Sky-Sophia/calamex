use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptFilePayload {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) content: String,
    pub(crate) encoding: String,
    pub(crate) line_count: usize,
    pub(crate) char_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAssetPayload {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) mime_type: String,
    pub(crate) data_url: String,
    pub(crate) byte_size: usize,
}

#[derive(Debug, Deserialize)]
pub struct SaveScriptRequest {
    pub(crate) path: String,
    pub(crate) content: String,
    pub(crate) encoding: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatScriptRequest {
    pub(crate) path: Option<String>,
    pub(crate) content: String,
    pub(crate) encoding: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatScriptPayload {
    pub(crate) content: String,
    pub(crate) encoding: String,
    pub(crate) line_count: usize,
    pub(crate) char_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeScriptRequest {
    pub(crate) path: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDiagnosticPayload {
    pub(crate) line: usize,
    pub(crate) end_line: usize,
    pub(crate) column: usize,
    pub(crate) end_column: usize,
    pub(crate) level: String,
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeScriptPayload {
    pub(crate) available: bool,
    pub(crate) message: Option<String>,
    pub(crate) dialect: String,
    pub(crate) diagnostics: Vec<ScriptDiagnosticPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionOption {
    pub(crate) r#type: String,
    pub(crate) label: String,
    pub(crate) available: bool,
    pub(crate) description: String,
    pub(crate) command_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEnvironment {
    pub(crate) recommended: String,
    pub(crate) has_any: bool,
    pub(crate) executors: Vec<ExecutionOption>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) has_children: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryPayload {
    pub(crate) root_path: String,
    pub(crate) root_name: String,
    pub(crate) entries: Vec<WorkspaceEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathCreateRequest {
    pub(crate) parent_path: String,
    pub(crate) root_path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathCreatePayload {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathRenameRequest {
    pub(crate) path: String,
    pub(crate) root_path: String,
    pub(crate) new_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathRenamePayload {
    pub(crate) old_path: String,
    pub(crate) new_path: String,
    pub(crate) name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathDeleteRequest {
    pub(crate) path: String,
    pub(crate) root_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathDeletePayload {
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionTestRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionTestPayload {
    pub(crate) ok: bool,
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryListRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryEntryPayload {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryListPayload {
    pub(crate) path: String,
    pub(crate) entries: Vec<SshDirectoryEntryPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileDownloadRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_path: String,
    pub(crate) local_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileDownloadPayload {
    pub(crate) remote_path: String,
    pub(crate) local_path: String,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileUploadRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) local_path: String,
    pub(crate) remote_directory: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileUploadPayload {
    pub(crate) local_path: String,
    pub(crate) remote_path: String,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathDeleteRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathDeletePayload {
    pub(crate) remote_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathRenameRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_path: String,
    pub(crate) new_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathRenamePayload {
    pub(crate) old_path: String,
    pub(crate) new_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryCreateRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_directory: String,
    pub(crate) name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryCreatePayload {
    pub(crate) remote_path: String,
}

#[derive(Debug, Serialize)]
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
