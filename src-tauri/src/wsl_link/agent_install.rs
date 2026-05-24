use std::{
    fs,
    path::{Path, PathBuf},
};

use thiserror::Error;

use super::{
    agent_runtime::DEFAULT_AGENT_NOISE_CONFIG_PATH,
    noise_material::{
        encode_agent_material, load_agent_material_from_file, WslLinkAgentNoiseMaterial,
        WslLinkNoiseMaterialError,
    },
    types::now_unix_ms,
};

pub const DEFAULT_AGENT_CONFIG_DIR: &str = "/etc/calamex/wsl-link";
pub const AGENT_NOISE_CONFIG_FILE_NAME: &str = "agent-noise.json";

#[derive(Debug, Error)]
pub enum WslLinkAgentInstallError {
    #[error("WSL Link agent 安装路径不是目录：{0}")]
    TargetIsNotDirectory(PathBuf),
    #[error("WSL Link agent 配置安装 IO 失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("WSL Link agent Noise 配置编码失败：{0}")]
    NoiseMaterial(#[from] WslLinkNoiseMaterialError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslLinkAgentInstallPlan {
    pub config_dir: PathBuf,
    pub noise_config_path: PathBuf,
}

impl WslLinkAgentInstallPlan {
    pub fn default_linux() -> Self {
        let config_dir = PathBuf::from(DEFAULT_AGENT_CONFIG_DIR);
        Self {
            noise_config_path: PathBuf::from(DEFAULT_AGENT_NOISE_CONFIG_PATH),
            config_dir,
        }
    }

    pub fn for_config_dir(config_dir: PathBuf) -> Self {
        Self {
            noise_config_path: config_dir.join(AGENT_NOISE_CONFIG_FILE_NAME),
            config_dir,
        }
    }
}

pub fn install_agent_noise_material(
    config_dir: &Path,
    material: &WslLinkAgentNoiseMaterial,
) -> Result<PathBuf, WslLinkAgentInstallError> {
    prepare_config_dir(config_dir)?;
    let target_path = config_dir.join(AGENT_NOISE_CONFIG_FILE_NAME);
    let temp_path = config_dir.join(format!(
        ".{AGENT_NOISE_CONFIG_FILE_NAME}.tmp-{}-{}",
        std::process::id(),
        now_unix_ms()
    ));
    let encoded = encode_agent_material(material)?;
    // 改动 2 + 3: 写入 + rename 失败时清理临时文件,避免在 /etc 下留点文件残留
    write_atomically_with_secret_mode(&temp_path, &target_path, encoded.as_bytes())?;
    // Round-trip 校验:确保刚落盘的 agent-noise.json 能被 agent 解析回来。
    let _ = load_agent_material_from_file(&target_path)?;
    Ok(target_path)
}

// 改动 1 + 2 + 3: 把 "atomic write + chmod 0600 + 失败清理" 集中,
// 删除原本 rename 之后的多余 chmod(Unix rename 已经保留临时文件的权限位)。
fn write_atomically_with_secret_mode(
    temp_path: &Path,
    target_path: &Path,
    bytes: &[u8],
) -> Result<(), WslLinkAgentInstallError> {
    let outcome = (|| -> Result<(), WslLinkAgentInstallError> {
        fs::write(temp_path, bytes)?;
        set_secret_file_permissions(temp_path)?;
        fs::rename(temp_path, target_path)?;
        Ok(())
    })();
    if outcome.is_err() {
        // 失败时尽力删除残留的临时文件;忽略二次错误,保留原始错误向上传递。
        let _ = fs::remove_file(temp_path);
    }
    outcome
}

fn prepare_config_dir(config_dir: &Path) -> Result<(), WslLinkAgentInstallError> {
    fs::create_dir_all(config_dir)?;
    if !config_dir.is_dir() {
        return Err(WslLinkAgentInstallError::TargetIsNotDirectory(
            config_dir.to_path_buf(),
        ));
    }
    set_secret_dir_permissions(config_dir)?;
    Ok(())
}

#[cfg(unix)]
fn set_secret_dir_permissions(path: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_secret_dir_permissions(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(unix)]
fn set_secret_file_permissions(path: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_secret_file_permissions(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        super::noise_material::{generate_pairing_material, load_agent_material_from_file},
        install_agent_noise_material, write_atomically_with_secret_mode, WslLinkAgentInstallPlan,
        AGENT_NOISE_CONFIG_FILE_NAME, DEFAULT_AGENT_CONFIG_DIR,
    };

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "calamex-wsl-link-agent-install-{name}-{}-{}",
            std::process::id(),
            super::now_unix_ms()
        ))
    }

    #[test]
    fn default_install_plan_matches_agent_runtime_path() {
        let plan = WslLinkAgentInstallPlan::default_linux();
        assert_eq!(
            plan.config_dir,
            std::path::PathBuf::from(DEFAULT_AGENT_CONFIG_DIR)
        );
        assert_eq!(
            plan.noise_config_path,
            std::path::PathBuf::from(super::DEFAULT_AGENT_NOISE_CONFIG_PATH)
        );
    }

    #[test]
    fn install_agent_noise_material_writes_loadable_config() {
        let dir = temp_dir("write-loadable");
        let material = generate_pairing_material().expect("pairing material should generate");
        let path =
            install_agent_noise_material(&dir, &material.agent).expect("install should work");
        let loaded = load_agent_material_from_file(&path).expect("installed material should load");
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some(AGENT_NOISE_CONFIG_FILE_NAME)
        );
        assert_eq!(loaded, material.agent);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn install_agent_noise_material_rejects_file_target_dir() {
        let dir = temp_dir("file-target");
        let material = generate_pairing_material().expect("pairing material should generate");
        fs::write(&dir, "not-a-dir").expect("test file should write");
        let result = install_agent_noise_material(&dir, &material.agent);
        assert!(result.is_err());
        let _ = fs::remove_file(dir);
    }

    // 改动 2 的回归测试:rename 失败时临时文件必须被清理。
    // 通过把 target 设成一个已存在的目录(`rename` 到目录会失败)来触发失败路径。
    #[test]
    fn atomic_write_cleans_up_temp_when_rename_fails() {
        let dir = temp_dir("rename-fail");
        fs::create_dir_all(&dir).expect("test dir should create");
        let temp_path = dir.join(".agent-noise.json.tmp-rename-fail");
        let target_path = dir.join("target-as-dir");
        fs::create_dir(&target_path).expect("target dir should create");
        // 在该目录下再放一个文件,使 rename(temp -> dir) 在 Linux 上必然返回 EISDIR/ENOTEMPTY。
        fs::write(target_path.join("guard"), b"x").expect("guard file should write");

        let result = write_atomically_with_secret_mode(&temp_path, &target_path, b"payload");
        assert!(result.is_err(), "rename 到非空目录应当失败");
        assert!(
            !temp_path.exists(),
            "失败路径必须清理临时文件,实际仍存在：{}",
            temp_path.display()
        );

        let _ = fs::remove_dir_all(dir);
    }
}