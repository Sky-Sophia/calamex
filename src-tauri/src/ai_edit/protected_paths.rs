//! AED 内置受保护路径判定。
//!
//! 这些路径默认禁止 AI 自动写盘，需要用户在 UI 中显式二次确认才能放行。
//!
//! ## 匹配语义
//!
//! - 输入路径会被规范化：反斜杠转正斜杠、去掉 `./` 与开头的 `/`、整体转小写。
//! - 受保护"目录链"（如 `.git`、`node_modules`、`src-tauri/target` 等）允许
//!   出现在路径的**任意层级**，因此 `D:/repo/.git/config` 与 `.git/config`
//!   都会被判定为受保护。
//! - `.env` / `.env.*` 既匹配根级也匹配子目录下的同名文件。
//! - 锁文件包含通配 `*.lock`，以及 `pnpm-lock.yaml` / `cargo.lock` 的精确匹配。
//!
//! ## ⚠️ 双源同步警告
//!
//! [`BUILTIN_PROTECTED_PATTERNS`] 是给前端 UI / 文档展示用的 glob 字面量，
//! 而 [`is_builtin_protected_path`] 是后端实际生效的判定函数。两者**互不
//! 自动同步**——新增 / 删除 / 调整任何模式时，必须同时更新：
//!
//! 1. [`BUILTIN_PROTECTED_PATTERNS`] 数组；
//! 2. 本模块内对应的 `matches_protected_*` 子函数；
//! 3. `tests::builtins_cover_all_declared_patterns` 中的长度断言；
//! 4. `tests::builtin_patterns_have_positive_and_negative_examples` 中的样例。

/// 受保护路径模式的对外（UI / 文档）展示来源。
///
/// **注意**：这些字符串只是 glob 字面量，并不是匹配引擎本身。实际判定逻辑在
/// [`is_builtin_protected_path`]，两者必须人工保持一致。
const BUILTIN_PROTECTED_PATTERNS: &[&str] = &[
    ".git/**",
    "node_modules/**",
    "src-tauri/target/**",
    "dist/**",
    ".env",
    ".env.*",
    "*.lock",
    "pnpm-lock.yaml",
    "cargo.lock",
    ".notion-ide-ai/**",
];

/// 返回所有内置受保护路径的 glob 字面量，供前端展示 / 文档生成使用。
pub fn builtin_patterns() -> &'static [&'static str] {
    BUILTIN_PROTECTED_PATTERNS
}

/// 判断给定路径是否命中任意一条内置受保护规则。
///
/// 路径会先被 [`normalize_path`] 规范化为正斜杠 + 全小写形式后再判定。
/// 空路径直接返回 `false`，不再继续匹配。
pub fn is_builtin_protected_path(path: &str) -> bool {
    let normalized = normalize_path(path);
    if normalized.is_empty() {
        return false;
    }
    let segments = path_segments(&normalized);

    matches_protected_directory(&segments)
        || matches_protected_dotenv(&normalized)
        || matches_protected_lockfile(&normalized)
}

// ============================================================================
// 子规则：分组实现
// ============================================================================

/// 受保护目录链（任意一段子序列出现在路径中即视为命中）。
///
/// 对应 glob：`.git/**`、`node_modules/**`、`src-tauri/target/**`、`dist/**`、
/// `.notion-ide-ai/**`。
fn matches_protected_directory(segments: &[&str]) -> bool {
    /// 表驱动：新增受保护目录只需在这里追加一行。
    const PROTECTED_CHAINS: &[&[&str]] = &[
        &[".git"],
        &["node_modules"],
        &["src-tauri", "target"],
        &["dist"],
        &[".notion-ide-ai"],
    ];

    PROTECTED_CHAINS
        .iter()
        .any(|chain| matches_directory_chain(segments, chain))
}

/// `.env` 与 `.env.*` 系列。
///
/// - 根级 `.env`、`/.env`（任意层级下的 `.env`）。
/// - `.env.<anything>`（如 `.env.local`、`.env.production` 等）。
fn matches_protected_dotenv(normalized: &str) -> bool {
    normalized == ".env"
        || normalized.ends_with("/.env")
        || normalized.starts_with(".env.")
        || normalized.contains("/.env.")
}

/// 锁文件：`*.lock` 通配 + `pnpm-lock.yaml` / `cargo.lock` 的精确匹配。
///
/// 注意 `cargo.lock` 的判定依赖 [`normalize_path`] 已经把整体转小写，因此
/// 大小写形式（`Cargo.lock` / `CARGO.LOCK`）都会被命中。
fn matches_protected_lockfile(normalized: &str) -> bool {
    normalized.ends_with(".lock")
        || normalized == "pnpm-lock.yaml"
        || normalized.ends_with("/pnpm-lock.yaml")
        || normalized == "cargo.lock"
        || normalized.ends_with("/cargo.lock")
}

// ============================================================================
// 路径辅助函数
// ============================================================================

/// 把外部传入的路径规范化为：
///
/// 1. 去除前后空白；
/// 2. 反斜杠 `\` 替换为正斜杠 `/`；
/// 3. 去除开头的 `./` 与 `/`；
/// 4. 整体小写。
///
/// 这样可以同时兼容 Windows 风格、POSIX 风格、相对/绝对路径、大小写差异。
fn normalize_path(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_lowercase()
}

/// 把规范化后的路径切成非空的、非 `.` 的目录段。
fn path_segments(value: &str) -> Vec<&str> {
    value
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect()
}

/// 检查 `expected` 是否作为连续子序列出现在 `segments` 中（任意层级）。
///
/// 例如 `expected = ["src-tauri", "target"]` 会匹配
/// `["repo", "src-tauri", "target", "debug"]`，但不会匹配
/// `["src-tauri", "src", "target"]`（中间被打断）。
fn matches_directory_chain(segments: &[&str], expected: &[&str]) -> bool {
    if expected.is_empty() || segments.len() < expected.len() {
        return false;
    }
    segments
        .windows(expected.len())
        .any(|window| window == expected)
}

#[cfg(test)]
mod tests {
    use super::{builtin_patterns, is_builtin_protected_path};

    #[test]
    fn builtins_cover_all_declared_patterns() {
        assert_eq!(builtin_patterns().len(), 10);
    }

    #[test]
    fn builtin_patterns_have_positive_and_negative_examples() {
        let cases = [
            (".git/config", true, ".git/**"),
            ("D:/repo/.git/config", true, ".git/**"),
            ("src/.gitignore", false, ".git/**"),
            ("node_modules/vue/index.js", true, "node_modules/**"),
            ("D:/repo/node_modules/vue/index.js", true, "node_modules/**"),
            ("src/node_modules_hint.ts", false, "node_modules/**"),
            ("src-tauri/target/debug/app.exe", true, "src-tauri/target/**"),
            (
                "D:/repo/src-tauri/target/debug/app.exe",
                true,
                "src-tauri/target/**",
            ),
            ("src-tauri/src/targeting.rs", false, "src-tauri/target/**"),
            ("dist/index.html", true, "dist/**"),
            ("src/distilled.ts", false, "dist/**"),
            (".env", true, ".env"),
            ("D:/repo/.env", true, ".env"),
            ("src/env.ts", false, ".env"),
            (".env.local", true, ".env.*"),
            ("D:/repo/.env.local", true, ".env.*"),
            ("env.local", false, ".env.*"),
            ("pnpm-lock.yaml", true, "pnpm-lock.yaml"),
            ("D:/repo/pnpm-lock.yaml", true, "pnpm-lock.yaml"),
            ("pnpm-lock.yml", false, "pnpm-lock.yaml"),
            ("Cargo.lock", true, "Cargo.lock"),
            ("D:/repo/Cargo.lock", true, "Cargo.lock"),
            ("Cargo.toml", false, "Cargo.lock"),
            ("package.lock", true, "*.lock"),
            ("package-lock.json", false, "*.lock"),
            (".notion-ide-ai/edits/state.json", true, ".notion-ide-ai/**"),
            (
                "D:/repo/.notion-ide-ai/edits/state.json",
                true,
                ".notion-ide-ai/**",
            ),
            ("notion-ide-ai/state.json", false, ".notion-ide-ai/**"),
        ];

        for (path, expected, pattern) in cases {
            assert_eq!(
                is_builtin_protected_path(path),
                expected,
                "pattern {pattern} mismatch for {path}",
            );
        }
    }
}