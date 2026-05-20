//! AED 内置受保护路径判定。
//!
//! 受保护路径是 AED 自动写盘的硬边界：命中后必须拒绝，不能靠前端提示兜底。
//! 本模块只负责“哪些路径不能碰”的模式匹配，路径 UTF-8、`..`、工作区沙箱
//! 等安全校验统一放在 `path_security`。

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use std::path::Path;
use std::sync::LazyLock;

/// 受保护路径模式的对外展示来源。
///
/// 这些模式同样用于构建后端 `globset`，避免 UI/文档与真实判定双源漂移。
const BUILTIN_PROTECTED_PATTERNS: &[&str] = &[
    ".git/**",
    ".hg/**",
    ".svn/**",
    "node_modules/**",
    "src-tauri/target/**",
    "target/**",
    "dist/**",
    "build/**",
    "coverage/**",
    ".env",
    ".env.*",
    "*.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
    ".notion-ide-ai/**",
    ".aster/**",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "id_rsa",
    "id_ed25519",
];

static BUILTIN_GLOB_SET: LazyLock<GlobSet> = LazyLock::new(|| {
    let mut builder = GlobSetBuilder::new();
    for pattern in expanded_patterns(builtin_patterns()) {
        let glob = GlobBuilder::new(&pattern)
            .literal_separator(true)
            .case_insensitive(true)
            .build()
            .expect("内置 AED protected path glob 必须合法");
        builder.add(glob);
    }
    builder
        .build()
        .expect("内置 AED protected path glob set 必须可构建")
});

/// 返回所有内置受保护路径的 glob 字面量，供前端展示 / 文档生成使用。
pub fn builtin_patterns() -> &'static [&'static str] {
    BUILTIN_PROTECTED_PATTERNS
}

/// 判断给定路径是否命中任意一条内置受保护规则。
pub fn is_builtin_protected_path(path: &str) -> bool {
    let normalized = normalize_path(path);
    if normalized.is_empty() {
        return false;
    }
    BUILTIN_GLOB_SET.is_match(Path::new(&normalized))
}

fn expanded_patterns(patterns: &[&str]) -> Vec<String> {
    let mut expanded = Vec::with_capacity(patterns.len() * 4);
    for pattern in patterns {
        let normalized = normalize_path(pattern);
        if normalized.is_empty() {
            continue;
        }

        push_unique(&mut expanded, normalized.clone());

        if !normalized.starts_with("**/") {
            push_unique(&mut expanded, format!("**/{normalized}"));
        }

        if let Some(directory) = normalized.strip_suffix("/**") {
            push_unique(&mut expanded, directory.to_string());
            push_unique(&mut expanded, format!("**/{directory}"));
        }
    }
    expanded
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|item| item == &value) {
        values.push(value);
    }
}

/// 规范化为 `globset` 友好的路径文本。
fn normalize_path(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{builtin_patterns, is_builtin_protected_path};

    #[test]
    fn builtins_cover_all_declared_patterns() {
        assert_eq!(builtin_patterns().len(), 25);
    }

    #[test]
    fn builtin_patterns_have_positive_and_negative_examples() {
        let cases = [
            (".git/config", true, ".git/**"),
            ("D:/repo/.git/config", true, ".git/**"),
            ("src/.gitignore", false, ".git/**"),
            (".hg/store", true, ".hg/**"),
            ("src/hg/store", false, ".hg/**"),
            (".svn/wc.db", true, ".svn/**"),
            ("node_modules/vue/index.js", true, "node_modules/**"),
            ("D:/repo/node_modules/vue/index.js", true, "node_modules/**"),
            ("src/node_modules_hint.ts", false, "node_modules/**"),
            (
                "src-tauri/target/debug/app.exe",
                true,
                "src-tauri/target/**",
            ),
            (
                "D:/repo/src-tauri/target/debug/app.exe",
                true,
                "src-tauri/target/**",
            ),
            ("src-tauri/src/targeting.rs", false, "src-tauri/target/**"),
            ("target/debug/app.exe", true, "target/**"),
            ("src/targeting.rs", false, "target/**"),
            ("dist/index.html", true, "dist/**"),
            ("src/distilled.ts", false, "dist/**"),
            ("build/app.js", true, "build/**"),
            ("builder/app.js", false, "build/**"),
            ("coverage/lcov.info", true, "coverage/**"),
            ("src/coverage-report.ts", false, "coverage/**"),
            (".env", true, ".env"),
            ("D:/repo/.env", true, ".env"),
            ("src/env.ts", false, ".env"),
            (".env.local", true, ".env.*"),
            ("D:/repo/.env.production", true, ".env.*"),
            ("env.local", false, ".env.*"),
            ("pnpm-lock.yaml", true, "pnpm-lock.yaml"),
            ("D:/repo/pnpm-lock.yaml", true, "pnpm-lock.yaml"),
            ("pnpm-lock.yml", false, "pnpm-lock.yaml"),
            ("package-lock.json", true, "package-lock.json"),
            ("yarn.lock", true, "yarn.lock"),
            ("bun.lockb", true, "bun.lockb"),
            ("Cargo.lock", true, "Cargo.lock"),
            ("D:/repo/Cargo.lock", true, "Cargo.lock"),
            ("Cargo.toml", false, "Cargo.lock"),
            ("package.lock", true, "*.lock"),
            ("package-lock.json", true, "package-lock.json"),
            (".notion-ide-ai/edits/state.json", true, ".notion-ide-ai/**"),
            (
                "D:/repo/.notion-ide-ai/edits/state.json",
                true,
                ".notion-ide-ai/**",
            ),
            ("notion-ide-ai/state.json", false, ".notion-ide-ai/**"),
            (".aster/blobs/ab/hash", true, ".aster/**"),
            ("src/aster.ts", false, ".aster/**"),
            ("secrets/prod.pem", true, "*.pem"),
            ("secrets/prod.key", true, "*.key"),
            ("cert/prod.p12", true, "*.p12"),
            ("cert/prod.pfx", true, "*.pfx"),
            ("keys/id_rsa", true, "id_rsa"),
            ("keys/id_ed25519", true, "id_ed25519"),
            ("src/id_rsa_notes.md", false, "id_rsa"),
            ("脚本/发布.sh", false, "unicode path"),
            ("脚本/🔧.sh", false, "emoji path"),
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
