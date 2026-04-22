use super::{
    line_count, ImageAssetPayload, SaveScriptRequest, ScriptFilePayload, StartupWorkspacePayload,
    WorkspaceDirectoryPayload, WorkspaceEntry,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use encoding_rs::{GB18030, UTF_16BE, UTF_16LE, UTF_8};
use std::{
    borrow::Cow,
    env, fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const DEFAULT_WORKSPACE_DIRECTORY_NAME: &str = "builtin-workspace";
const DEFAULT_WORKSPACE_SCRIPT_NAME: &str = "startup.sh";
const DEFAULT_WORKSPACE_SCRIPT_CONTENT: &str = "#!/bin/bash\n\nset -euo pipefail\n\nmain() {\n  echo \"Welcome to SH Editor\"\n}\n\nmain \"$@\"\n";

#[tauri::command]
pub fn get_startup_workspace(app: AppHandle) -> Result<StartupWorkspacePayload, String> {
    let (workspace_root, default_file_path) = ensure_startup_workspace(&app)?;

    Ok(StartupWorkspacePayload {
        root_path: workspace_root.to_string_lossy().to_string(),
        root_name: workspace_name(&workspace_root),
        default_file_path: default_file_path.map(|value| value.to_string_lossy().to_string()),
        protected_root_paths: vec![workspace_root.to_string_lossy().to_string()],
    })
}

#[tauri::command]
pub fn load_script(path: String) -> Result<ScriptFilePayload, String> {
    let file_path = PathBuf::from(&path);
    let bytes = fs::read(&file_path).map_err(|error| format!("读取脚本失败：{error}"))?;
    let (content, encoding) = decode_script_bytes(&bytes)?;
    Ok(build_script_payload(file_path, content, encoding))
}

#[tauri::command]
pub fn load_image_asset(path: String) -> Result<ImageAssetPayload, String> {
    let file_path = PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| format!("读取图片资源失败：{error}"))?;

    if !file_path.is_file() {
        return Err("目标图片不存在或不是有效文件。".into());
    }

    let bytes = fs::read(&file_path).map_err(|error| format!("读取图片资源失败：{error}"))?;
    build_image_asset_payload(file_path, bytes)
}

#[tauri::command]
pub fn save_script(payload: SaveScriptRequest) -> Result<ScriptFilePayload, String> {
    let file_path = PathBuf::from(&payload.path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
    }

    let bytes = encode_script_content(&payload.content, &payload.encoding)?;
    fs::write(&file_path, bytes).map_err(|error| format!("保存脚本失败：{error}"))?;
    Ok(build_script_payload(
        file_path,
        payload.content,
        payload.encoding,
    ))
}

#[tauri::command]
pub fn list_workspace_entries(
    path: Option<String>,
    root_path: Option<String>,
) -> Result<WorkspaceDirectoryPayload, String> {
    let workspace_root = resolve_workspace_root(root_path)?;
    let target_path = path
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_root.clone())
        .canonicalize()
        .map_err(|error| format!("读取资源目录失败：{error}"))?;

    if !target_path.starts_with(&workspace_root) {
        return Err("仅允许浏览当前资源根目录。".into());
    }

    if !target_path.is_dir() {
        return Err("目标路径不是有效目录。".into());
    }

    Ok(WorkspaceDirectoryPayload {
        root_path: workspace_root.to_string_lossy().to_string(),
        root_name: workspace_name(&workspace_root),
        entries: read_workspace_entries(&target_path)?,
    })
}

pub(crate) fn resolve_workspace_root(selected_root: Option<String>) -> Result<PathBuf, String> {
    if let Some(root) = selected_root {
        let root_path = PathBuf::from(root)
            .canonicalize()
            .map_err(|error| format!("读取资源根目录失败：{error}"))?;

        if !root_path.is_dir() {
            return Err("资源根路径不是有效目录。".into());
        }

        return Ok(root_path);
    }

    if let Ok(current_dir) = env::current_dir() {
        if current_dir.join("package.json").exists()
            || current_dir.join("src").exists()
            || current_dir.join("resources").exists()
        {
            return current_dir
                .canonicalize()
                .map_err(|error| format!("读取工作区目录失败：{error}"));
        }

        if current_dir
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("src-tauri"))
        {
            if let Some(parent) = current_dir.parent() {
                return parent
                    .to_path_buf()
                    .canonicalize()
                    .map_err(|error| format!("读取工作区目录失败：{error}"));
            }
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fallback_root = manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(manifest_dir);
    fallback_root
        .canonicalize()
        .map_err(|error| format!("读取工作区目录失败：{error}"))
}

pub(crate) fn workspace_name(root_path: &Path) -> String {
    root_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace")
        .to_string()
}

pub(crate) fn decode_script_bytes(bytes: &[u8]) -> Result<(String, String), String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let content = String::from_utf8(bytes[3..].to_vec()).map_err(|error| error.to_string())?;
        return Ok((content, "utf-8-bom".into()));
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_with_encoding(&bytes[2..], UTF_16LE, "utf-16le");
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_with_encoding(&bytes[2..], UTF_16BE, "utf-16be");
    }

    if bytes.contains(&0) {
        return Err("当前文件疑似二进制内容，暂不支持在编辑器中打开。".into());
    }

    let (utf8, _, utf8_errors) = UTF_8.decode(bytes);
    if !utf8_errors {
        return Ok((utf8.into_owned(), "utf-8".into()));
    }

    let (gb18030, _, gb_errors) = GB18030.decode(bytes);
    if !gb_errors {
        return Ok((gb18030.into_owned(), "gb18030".into()));
    }

    Err("无法识别文件编码，请确认脚本是否为常见 UTF-8 / GB 编码。".into())
}

pub(crate) fn encode_script_content(content: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "utf-8" => Ok(content.as_bytes().to_vec()),
        "utf-8-bom" => {
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(content.as_bytes());
            Ok(bytes)
        }
        "utf-16le" => encode_with_encoding(content, UTF_16LE, "utf-16le", true),
        "utf-16be" => encode_with_encoding(content, UTF_16BE, "utf-16be", true),
        "gbk" => encode_with_encoding_name(content, "gbk"),
        "gb18030" => encode_with_encoding_name(content, "gb18030"),
        _ => Err(format!("暂不支持编码：{encoding}")),
    }
}

fn build_script_payload(path: PathBuf, content: String, encoding: String) -> ScriptFilePayload {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled.sh")
        .to_string();

    ScriptFilePayload {
        path: path.to_string_lossy().to_string(),
        name,
        line_count: line_count(&content),
        char_count: content.chars().count(),
        content,
        encoding,
    }
}

fn build_image_asset_payload(path: PathBuf, bytes: Vec<u8>) -> Result<ImageAssetPayload, String> {
    let mime_type = resolve_image_mime_type(&path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_string();
    let byte_size = bytes.len();
    let data_url = format!("data:{mime_type};base64,{}", STANDARD.encode(&bytes));

    Ok(ImageAssetPayload {
        path: path.to_string_lossy().to_string(),
        name,
        mime_type: mime_type.to_string(),
        data_url,
        byte_size,
    })
}

fn resolve_image_mime_type(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "无法识别图片格式。".to_string())?;

    match extension.as_str() {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "gif" => Ok("image/gif"),
        "webp" => Ok("image/webp"),
        "bmp" => Ok("image/bmp"),
        "svg" => Ok("image/svg+xml"),
        "ico" => Ok("image/x-icon"),
        _ => Err(format!("暂不支持预览该图片格式：{extension}")),
    }
}

fn resolve_development_startup_workspace() -> Option<(PathBuf, Option<PathBuf>)> {
    if !cfg!(debug_assertions) {
        return None;
    }

    let workspace_root = resolve_workspace_root(None).ok()?;
    if git2::Repository::discover(&workspace_root).is_err() {
        return None;
    }

    Some((workspace_root, None))
}

fn ensure_startup_workspace(app: &AppHandle) -> Result<(PathBuf, Option<PathBuf>), String> {
    if let Some(workspace) = resolve_development_startup_workspace() {
        return Ok(workspace);
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取应用数据目录失败：{error}"))?;

    fs::create_dir_all(&app_data_dir).map_err(|error| format!("创建应用数据目录失败：{error}"))?;

    let workspace_root = app_data_dir.join(DEFAULT_WORKSPACE_DIRECTORY_NAME);
    fs::create_dir_all(&workspace_root).map_err(|error| format!("创建默认工作区失败：{error}"))?;

    let default_script_path = workspace_root.join(DEFAULT_WORKSPACE_SCRIPT_NAME);
    let should_seed_default_script = match fs::metadata(&default_script_path) {
        Ok(metadata) => metadata.len() == 0,
        Err(_) => true,
    };

    if should_seed_default_script {
        fs::write(
            &default_script_path,
            DEFAULT_WORKSPACE_SCRIPT_CONTENT.as_bytes(),
        )
        .map_err(|error| format!("写入默认脚本失败：{error}"))?;
    }

    let canonical_workspace_root = workspace_root
        .canonicalize()
        .map_err(|error| format!("读取默认工作区失败：{error}"))?;
    let canonical_default_script = default_script_path
        .canonicalize()
        .map_err(|error| format!("读取默认脚本失败：{error}"))?;

    Ok((canonical_workspace_root, Some(canonical_default_script)))
}

fn read_workspace_entries(directory: &Path) -> Result<Vec<WorkspaceEntry>, String> {
    let read_dir = fs::read_dir(directory).map_err(|error| format!("读取资源目录失败：{error}"))?;
    let mut entries = Vec::new();
    let (minimum_entry_count, _) = read_dir.size_hint();
    entries.reserve(minimum_entry_count);

    for item in read_dir {
        let Ok(entry) = item else {
            continue;
        };

        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let is_directory = file_type.is_dir();

        entries.push(WorkspaceEntry {
            path: path.to_string_lossy().to_string(),
            name: entry.file_name().to_string_lossy().to_string(),
            kind: if is_directory {
                "directory".into()
            } else {
                "file".into()
            },
            has_children: is_directory && directory_has_entries(&path),
        });
    }

    entries.sort_by_cached_key(|entry| {
        (
            entry.kind != "directory",
            entry.name.to_lowercase(),
            entry.name.clone(),
        )
    });
    Ok(entries)
}

fn directory_has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut iterator| iterator.any(|item| item.is_ok()))
        .unwrap_or(false)
}

fn decode_with_encoding(
    bytes: &[u8],
    encoding: &'static encoding_rs::Encoding,
    encoding_name: &str,
) -> Result<(String, String), String> {
    let (content, _, had_errors) = encoding.decode(bytes);
    if had_errors {
        return Err(format!("使用 {encoding_name} 解码脚本失败。"));
    }

    Ok((content.into_owned(), encoding_name.to_string()))
}

fn encode_with_encoding(
    content: &str,
    encoding: &'static encoding_rs::Encoding,
    label: &str,
    with_bom: bool,
) -> Result<Vec<u8>, String> {
    let (bytes, _, had_errors) = encoding.encode(content);
    if had_errors {
        return Err(format!("将内容编码为 {label} 失败。"));
    }

    let mut result = Vec::new();
    if with_bom {
        if label == "utf-16le" {
            result.extend_from_slice(&[0xFF, 0xFE]);
        } else if label == "utf-16be" {
            result.extend_from_slice(&[0xFE, 0xFF]);
        }
    }
    result.extend_from_slice(bytes.as_ref());
    Ok(result)
}

fn encode_with_encoding_name(content: &str, label: &str) -> Result<Vec<u8>, String> {
    let (bytes, _, had_errors): (Cow<[u8]>, _, bool) = match label {
        "gbk" => encoding_rs::GBK.encode(content),
        "gb18030" => GB18030.encode(content),
        _ => return Err(format!("暂不支持编码：{label}")),
    };
    if had_errors {
        return Err(format!("将内容编码为 {label} 失败。"));
    }
    Ok(bytes.into_owned())
}
