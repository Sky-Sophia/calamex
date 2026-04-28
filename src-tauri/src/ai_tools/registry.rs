//! AI 工具能力清单与白名单判定。
//!
//! Phase 0 的工具集（[`PHASE0_TOOLS`]）是一份**编译期固定**的能力清单，
//! 任何会话允许调用的工具都必须先在这里登记。前端通过 [`list_tools`] 拿到
//! 完整清单用于展示，后端在转发工具调用前用 [`is_tool_allowed`] 做白名单校验。
//!
//! ## 字段语义
//!
//! - `read_only`：true 表示**永远**允许调用，与 `allow_write` 无关。
//! - `destructive`：true 表示该工具会对外部状态产生不可恢复的影响。即使
//!   `allow_write=true` 也**不**通过 [`is_tool_allowed`] —— 破坏性工具
//!   必须由更高级别的二次确认机制单独放行，本模块不在此处兜底。
//! - `requires_confirmation`：仅作给前端的元数据，提示 UI 在调用前弹窗
//!   二次确认。本模块不据此过滤。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolDefinition {
    pub name: &'static str,
    pub read_only: bool,
    pub destructive: bool,
    pub requires_confirmation: bool,
}

impl AiToolDefinition {
    /// 构造一个只读工具：永远允许调用，无需确认、不破坏外部状态。
    /// 用于消除清单中大量同样标志位的模板代码。
    const fn read_only(name: &'static str) -> Self {
        Self {
            name,
            read_only: true,
            destructive: false,
            requires_confirmation: false,
        }
    }
}

/// Phase 0 编译期工具清单。新增工具请在这里登记，并补充 `tests` 中的不变量。
pub const PHASE0_TOOLS: &[AiToolDefinition] = &[
    AiToolDefinition::read_only("read_current_file"),
    AiToolDefinition::read_only("read_selected_text"),
    AiToolDefinition::read_only("search_files"),
    AiToolDefinition::read_only("search_text"),
    AiToolDefinition::read_only("search_symbols"),
    AiToolDefinition::read_only("get_diagnostics"),
    AiToolDefinition::read_only("get_git_diff"),
    AiToolDefinition::read_only("get_terminal_log"),
    // 唯一的写入类工具：需要 allow_write=true 才会被白名单放行，
    // 同时 UI 必须做二次确认弹窗（requires_confirmation=true）。
    AiToolDefinition {
        name: "propose_patch",
        read_only: false,
        destructive: false,
        requires_confirmation: true,
    },
];

/// 返回对外可见的工具清单（深拷贝，便于序列化送给前端）。
pub fn list_tools() -> Vec<AiToolDefinition> {
    PHASE0_TOOLS.to_vec()
}

/// 按工具名查找定义。返回 `None` 表示未登记。
fn find_tool(name: &str) -> Option<&'static AiToolDefinition> {
    PHASE0_TOOLS.iter().find(|tool| tool.name == name)
}

/// 判断工具是否在当前授权下允许调用。
///
/// 规则（与字段语义一一对应，按顺序短路）：
/// 1. 工具必须存在于 [`PHASE0_TOOLS`]；
/// 2. 只读工具永远允许；
/// 3. 写入类、非破坏性工具仅在 `allow_write=true` 时允许；
/// 4. 破坏性工具一律拒绝（需要更高级别的二次确认通道单独放行）。
pub fn is_tool_allowed(name: &str, allow_write: bool) -> bool {
    let Some(tool) = find_tool(name) else {
        return false;
    };
    if tool.read_only {
        return true;
    }
    !tool.destructive && allow_write
}

#[cfg(test)]
mod tests {
    use super::{is_tool_allowed, list_tools, PHASE0_TOOLS};
    use std::collections::HashSet;

    #[test]
    fn write_tools_require_explicit_write_gate() {
        assert!(is_tool_allowed("read_current_file", false));
        assert!(!is_tool_allowed("propose_patch", false));
        assert!(is_tool_allowed("propose_patch", true));
        assert_eq!(list_tools().len(), 9);
    }

    #[test]
    fn unknown_tool_names_are_rejected() {
        assert!(!is_tool_allowed("nonexistent_tool", false));
        assert!(!is_tool_allowed("nonexistent_tool", true));
    }

    #[test]
    fn tool_names_are_unique() {
        let mut seen = HashSet::new();
        for tool in PHASE0_TOOLS {
            assert!(seen.insert(tool.name), "duplicate tool name: {}", tool.name);
        }
    }

    /// Phase 0 不变量：暂不允许任何破坏性工具进入清单。
    /// 一旦未来需要引入，请显式删除/调整本测试，以推动团队对此达成共识。
    #[test]
    fn phase0_has_no_destructive_tools() {
        for tool in PHASE0_TOOLS {
            assert!(
                !tool.destructive,
                "{} should not be destructive in Phase 0",
                tool.name
            );
        }
    }
}