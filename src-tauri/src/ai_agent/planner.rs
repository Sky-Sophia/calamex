use std::collections::HashSet;

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai_agent::policy::{
    classify_task as classify_by_policy, AgentTaskPolicyInput, MAX_PLAN_STEPS, MIN_PLAN_STEPS,
};
use crate::ai_tools::registry;
use crate::commands::contracts::{
    AiAgentApprovePlanPayload, AiAgentApprovePlanRequest, AiAgentClassifyTaskPayload,
    AiAgentClassifyTaskRequest, AiAgentPlanPayload, AiAgentPlanRequest, AiContextReferencePayload,
    AiTaskPlanReferencePayload, AiTaskPlanStepPayload,
};

pub struct AgentPlanner;

impl AgentPlanner {
    pub fn classify_task(
        payload: AiAgentClassifyTaskRequest,
    ) -> Result<AiAgentClassifyTaskPayload, String> {
        let goal = normalize_goal(&payload.goal)?;
        let decision = classify_by_policy(AgentTaskPolicyInput {
            goal,
            referenced_file_count: count_referenced_files(&payload.context),
        });

        Ok(AiAgentClassifyTaskPayload {
            classification: decision.classification.as_str().to_string(),
            should_enter_plan_mode: decision.should_enter_plan_mode,
            reason: decision.reason.to_string(),
        })
    }

    pub fn create_plan(payload: AiAgentPlanRequest) -> Result<AiAgentPlanPayload, String> {
        let goal = normalize_goal(&payload.goal)?;
        let referenced_file_count = count_referenced_files(&payload.context);
        let decision = classify_by_policy(AgentTaskPolicyInput {
            goal,
            referenced_file_count,
        });

        let mut steps = if decision.should_enter_plan_mode {
            build_contextual_plan_steps(goal, &payload.context)
        } else {
            build_simple_plan_steps(goal, &payload.context)
        };

        normalize_plan_steps(&mut steps);
        validate_plan_steps(&steps)?;
        audit::emit(AiAuditEventKind::AgentPlanCreated);

        Ok(AiAgentPlanPayload { steps })
    }

    pub fn approve_plan(
        payload: AiAgentApprovePlanRequest,
    ) -> Result<AiAgentApprovePlanPayload, String> {
        let _goal = normalize_goal(&payload.goal)?;

        validate_plan_steps(&payload.steps)?;
        audit::emit(AiAuditEventKind::AgentPlanApproved);

        Ok(AiAgentApprovePlanPayload {
            approved_at: chrono::Utc::now().to_rfc3339(),
            step_count: payload.steps.len(),
        })
    }
}

fn normalize_goal(goal: &str) -> Result<&str, String> {
    let trimmed = goal.trim();

    if trimmed.is_empty() {
        return Err(errors::error("AI_AGENT_PLAN_INVALID", "任务目标不能为空。"));
    }

    Ok(trimmed)
}

fn count_referenced_files(context: &[AiContextReferencePayload]) -> usize {
    context
        .iter()
        .filter_map(|reference| reference.path.as_deref())
        .filter(|path| !path.trim().is_empty())
        .collect::<HashSet<_>>()
        .len()
}

fn normalize_plan_steps(steps: &mut [AiTaskPlanStepPayload]) {
    for (index, step) in steps.iter_mut().enumerate() {
        step.index = index;
        if step.id.trim().is_empty() || step.id.starts_with("plan-step-") {
            step.id = format!("plan-step-{}", index + 1);
        }
        step.status = "pending".to_string();
        step.is_active = None;
    }
}

pub(crate) fn validate_plan_steps(steps: &[AiTaskPlanStepPayload]) -> Result<(), String> {
    if steps.len() < MIN_PLAN_STEPS {
        return Err(errors::error(
            "AI_AGENT_PLAN_TOO_SHORT",
            "计划步骤数必须在 2 到 6 之间。",
        ));
    }

    if steps.len() > MAX_PLAN_STEPS {
        return Err(errors::error(
            "AI_AGENT_PLAN_TOO_LONG",
            "计划步骤数必须在 2 到 6 之间。",
        ));
    }

    for (index, step) in steps.iter().enumerate() {
        validate_plan_step(index, step)?;
    }

    Ok(())
}

fn validate_plan_step(index: usize, step: &AiTaskPlanStepPayload) -> Result<(), String> {
    if step.index != index {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 index 必须按顺序排列。",
        ));
    }

    if step.title.trim().is_empty()
        || step.goal.trim().is_empty()
        || step.expected_output.trim().is_empty()
    {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤必须包含标题、目标与预期产物。",
        ));
    }

    if !matches!(
        step.kind.as_str(),
        "inspect" | "search" | "design" | "edit" | "verify" | "summarize"
    ) {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 kind 不在允许范围内。",
        ));
    }

    if !matches!(
        step.status.as_str(),
        "pending" | "running" | "done" | "failed" | "skipped" | "cancelled"
    ) {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 status 不在允许范围内。",
        ));
    }

    if !matches!(step.risk_level.as_str(), "low" | "medium" | "high") {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 riskLevel 不在允许范围内。",
        ));
    }

    if step.tools.is_empty() {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤必须声明至少一个已注册工具。",
        ));
    }

    for tool_name in &step.tools {
        if !registry::is_tool_registered(tool_name) {
            return Err(errors::error(
                "AI_AGENT_TOOL_NOT_ALLOWED",
                "计划包含未注册工具，已拒绝批准。",
            ));
        }
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct PlanProfile {
    target: String,
    references: Option<Vec<AiTaskPlanReferencePayload>>,
    is_ui_flow: bool,
    is_bug_fix: bool,
    is_file_edit: bool,
    is_shell_script: bool,
    needs_edit: bool,
    needs_tests: bool,
    needs_web: bool,
    needs_git: bool,
}

fn build_contextual_plan_steps(
    goal: &str,
    context: &[AiContextReferencePayload],
) -> Vec<AiTaskPlanStepPayload> {
    let profile = build_plan_profile(goal, context);
    let mut steps = Vec::new();
    let inspect_title = contextual_inspect_title(&profile);
    let inspect_goal = contextual_inspect_goal(goal, &profile);
    let inspect_output = contextual_inspect_output(&profile);

    steps.push(with_references(
        build_step(
            0,
            &inspect_title,
            &inspect_goal,
            "inspect",
            "low",
            contextual_inspect_tools(&profile),
            false,
            &inspect_output,
            Some("只读步骤无需回滚"),
        ),
        &profile.references,
    ));

    if profile.needs_web {
        steps.push(with_references(
            build_step(
                steps.len(),
                &format!("核对{}的外部约束", profile.target),
                &format!(
                    "为“{}”检索必要的官方资料或版本约束，避免依据过期规则改动",
                    goal
                ),
                "search",
                "medium",
                vec!["web_search", "web_fetch"],
                true,
                "产出可引用的外部依据、适用范围与不采用的方案",
                Some("网络读取不写盘，无需回滚"),
            ),
            &profile.references,
        ));
    }

    steps.push(with_references(
        build_step(
            steps.len(),
            contextual_design_title(&profile).as_str(),
            contextual_design_goal(goal, &profile).as_str(),
            "design",
            if profile.needs_edit { "medium" } else { "low" },
            contextual_design_tools(&profile),
            false,
            contextual_design_output(&profile).as_str(),
            Some("设计步骤只产出方案，不直接写盘"),
        ),
        &profile.references,
    ));

    if profile.needs_edit {
        steps.push(with_references(
            build_step(
                steps.len(),
                contextual_edit_title(&profile).as_str(),
                contextual_edit_goal(goal, &profile).as_str(),
                "edit",
                "medium",
                vec!["propose_patch", "get_git_diff"],
                true,
                contextual_edit_output(&profile).as_str(),
                Some("通过 AED patch 记录回滚本轮写盘"),
            ),
            &profile.references,
        ));
    }

    steps.push(with_references(
        build_step(
            steps.len(),
            contextual_verify_title(&profile).as_str(),
            contextual_verify_goal(goal, &profile).as_str(),
            "verify",
            "medium",
            contextual_verify_tools(&profile),
            profile.needs_tests || (profile.is_file_edit && profile.is_shell_script),
            contextual_verify_output(&profile).as_str(),
            Some("验证步骤失败时保留诊断与测试输出，不继续扩大改动"),
        ),
        &profile.references,
    ));

    steps
}

fn build_simple_plan_steps(
    goal: &str,
    context: &[AiContextReferencePayload],
) -> Vec<AiTaskPlanStepPayload> {
    let references = plan_references(context);
    vec![
        with_references(
            build_step(
                0,
                "读取当前请求上下文",
                &format!("读取与“{}”直接相关的当前文件或选区", goal),
                "inspect",
                "low",
                vec!["read_current_file"],
                false,
                "产出回答所需的最小上下文",
                Some("只读步骤无需回滚"),
            ),
            &references,
        ),
        with_references(
            build_step(
                1,
                "回答用户问题",
                &format!("基于已收集上下文回答“{}”", goal),
                "summarize",
                "low",
                vec!["get_diagnostics"],
                false,
                "输出直接结论、风险提示与必要后续建议",
                Some("无需回滚"),
            ),
            &references,
        ),
    ]
}

fn build_plan_profile(goal: &str, context: &[AiContextReferencePayload]) -> PlanProfile {
    let normalized_goal = goal.to_lowercase();
    let target = infer_target(goal, context);
    let needs_edit = contains_any(
        &normalized_goal,
        &[
            "修改", "修复", "实现", "改成", "加上", "补齐", "重构", "完善", "edit", "fix", "update",
        ],
    );
    let has_file_reference = contains_file_reference(context);
    let is_file_edit = needs_edit
        && has_file_reference
        && contains_any(
            &normalized_goal,
            &["文件", "当前文件", "这个文件", "脚本", "file", "script"],
        );
    let is_shell_script = is_shell_script_target(&target, context);

    PlanProfile {
        target,
        references: plan_references(context),
        is_ui_flow: contains_any(
            &normalized_goal,
            &[
                "ui",
                "界面",
                "交互",
                "对话流",
                "timeline",
                "折叠",
                "按钮",
                "vscode",
            ],
        ),
        is_bug_fix: contains_any(
            &normalized_goal,
            &[
                "失败",
                "报错",
                "bug",
                "修复",
                "不生效",
                "无效",
                "failed",
                "error",
            ],
        ),
        is_file_edit,
        is_shell_script,
        needs_edit,
        needs_tests: contains_any(
            &normalized_goal,
            &["测试", "验证", "test", "spec", "通过", "全过程", "一直修"],
        ),
        needs_web: contains_any(
            &normalized_goal,
            &["联网", "网络", "网页", "官方", "最新", "web", "docs"],
        ),
        needs_git: contains_any(
            &normalized_goal,
            &["git", "diff", "commit", "patch", "回滚"],
        ),
    }
}

fn contextual_inspect_title(profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        if profile.is_shell_script {
            return format!("读取 {} 脚本内容和诊断", profile.target);
        }

        return format!("读取 {} 当前内容和诊断", profile.target);
    }

    if profile.is_ui_flow {
        return "梳理对话流、计划面板和工具事件的责任边界".to_string();
    }

    if profile.is_bug_fix {
        return format!("复现并定位{}的失败路径", profile.target);
    }

    format!("读取{}相关上下文", profile.target)
}

fn contextual_inspect_goal(goal: &str, profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!(
            "读取“{}”涉及的 {} 内容、已有诊断和相关引用，确认可安全修改的边界",
            goal, profile.target
        );
    }

    if profile.is_ui_flow {
        return format!(
            "围绕“{}”读取相关 UI 与状态代码，确认消息流、计划状态和工具事件各自由谁负责",
            goal
        );
    }

    if profile.is_bug_fix {
        return format!("围绕“{}”确认复现入口、错误传播和状态残留点", goal);
    }

    format!("读取与“{}”直接相关的当前文件、搜索结果和诊断", goal)
}

fn contextual_inspect_output(profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!("产出 {} 的当前行为、可修改范围和已知风险", profile.target);
    }

    if profile.is_ui_flow {
        return "产出对话消息、计划面板、工具活动三条状态流的责任边界和失败点".to_string();
    }

    if profile.is_bug_fix {
        return format!("产出{}的复现路径、错误传播点与状态清理边界", profile.target);
    }

    format!("产出{}的影响范围与需要继续核对的边界", profile.target)
}

fn contextual_inspect_tools(profile: &PlanProfile) -> Vec<&'static str> {
    if profile.is_file_edit {
        return vec!["read_current_file", "get_diagnostics", "get_git_diff"];
    }

    if profile.is_ui_flow || profile.is_bug_fix {
        return vec!["read_current_file", "search_text", "get_diagnostics"];
    }

    vec!["read_current_file", "search_text", "get_diagnostics"]
}

fn contextual_design_title(profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!("判断 {} 需要完善的行为与边界", profile.target);
    }

    if profile.is_ui_flow {
        "设计对话流与折叠交互方案".to_string()
    } else if profile.is_bug_fix {
        "制定根因修复与风险控制".to_string()
    } else if profile.needs_git {
        "确认改动边界与回滚策略".to_string()
    } else {
        "制定最小实现方案".to_string()
    }
}

fn contextual_design_goal(goal: &str, profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!(
            "把“{}”落实为 {} 的具体修改点，明确输入、异常、幂等和验证边界",
            goal, profile.target
        );
    }

    if profile.is_ui_flow {
        return format!(
            "把“{}”拆成对话流呈现、计划折叠状态和运行反馈三条 UI 责任，确认最小改动点",
            goal
        );
    }

    if profile.is_bug_fix {
        return format!(
            "针对“{}”定位根因修复路径，明确错误传播、回滚和验证方式",
            goal
        );
    }

    format!("为“{}”确定最小可维护改动路径与验证方式", goal)
}

fn contextual_design_output(profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!(
            "产出 {} 的修改清单、边界条件和不扩大范围的说明",
            profile.target
        );
    }

    if profile.is_ui_flow {
        return "产出对话流活动、计划折叠按钮、最终回答展示的交互方案".to_string();
    }

    if profile.is_bug_fix {
        return format!("产出{}的根因、修复点、影响路径与风险控制", profile.target);
    }

    format!("产出{}的执行方案、边界与验证方式", profile.target)
}

fn contextual_design_tools(profile: &PlanProfile) -> Vec<&'static str> {
    if profile.is_file_edit {
        return vec!["get_diagnostics", "get_git_diff"];
    }

    if profile.is_ui_flow {
        return vec!["search_symbols", "get_git_diff"];
    }

    if profile.is_bug_fix {
        return vec!["search_text", "get_diagnostics", "get_git_diff"];
    }

    vec!["search_symbols", "get_git_diff"]
}

fn contextual_edit_title(profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!("更新 {} 并保留 Patch 记录", profile.target);
    }

    format!("最小改动{}并保留回滚点", profile.target)
}

fn contextual_edit_goal(goal: &str, profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!(
            "按已确认边界修改 {}，只处理“{}”要求的内容并记录 patch",
            profile.target, goal
        );
    }

    format!("按已确认方案修改“{}”相关代码，避免扩大到无关模块", goal)
}

fn contextual_edit_output(profile: &PlanProfile) -> String {
    if profile.is_file_edit {
        return format!("产出 {} 的实际改动、Patch 摘要与可回滚记录", profile.target);
    }

    format!("产出{}的实际改动、Patch 摘要与可回滚记录", profile.target)
}

fn contextual_verify_title(profile: &PlanProfile) -> String {
    if profile.needs_tests {
        "执行全过程测试并核对最终回答".to_string()
    } else if profile.is_file_edit && profile.is_shell_script {
        format!("运行 {} 的脚本最小验证", profile.target)
    } else if profile.is_file_edit {
        format!("验证 {} 改动并总结", profile.target)
    } else if profile.is_bug_fix {
        "验证失败路径已被根因修复".to_string()
    } else {
        "执行最小验证并总结结果".to_string()
    }
}

fn contextual_verify_goal(goal: &str, profile: &PlanProfile) -> String {
    if profile.needs_tests {
        return format!(
            "为“{}”执行覆盖用户提问、工具活动、计划状态与 AI 最终回答的全过程验证",
            goal
        );
    }

    if profile.is_file_edit && profile.is_shell_script {
        return format!(
            "对“{}”运行脚本相关的最小验证，并核对诊断与 diff 是否符合预期",
            goal
        );
    }

    if profile.is_file_edit {
        return format!("验证“{}”的文件改动、诊断结果和 diff 摘要", goal);
    }

    if profile.is_bug_fix {
        return format!("验证“{}”的失败路径不再复现，并检查诊断与 diff", goal);
    }

    format!("验证“{}”的改动结果，并整理剩余风险", goal)
}

fn contextual_verify_output(profile: &PlanProfile) -> String {
    if profile.needs_tests {
        return "产出测试文件、通过结果、用户提问与 AI 最终回答的断言证据".to_string();
    }

    if profile.is_file_edit && profile.is_shell_script {
        return format!("产出 {} 的脚本验证结果、诊断结论和剩余风险", profile.target);
    }

    if profile.is_file_edit {
        return format!("产出 {} 的诊断、diff 核对和最终说明", profile.target);
    }

    if profile.is_bug_fix {
        return format!("产出{}的复现闭环、修复结论与剩余风险", profile.target);
    }

    format!("产出{}的验证结论与后续建议", profile.target)
}

fn contextual_verify_tools(profile: &PlanProfile) -> Vec<&'static str> {
    if profile.needs_tests {
        return vec!["get_test_targets", "run_test", "get_diagnostics"];
    }

    if profile.is_file_edit && profile.is_shell_script {
        return vec!["run_command", "get_diagnostics", "get_git_diff"];
    }

    if profile.needs_git {
        return vec!["get_git_diff", "get_diagnostics"];
    }

    vec!["get_diagnostics", "get_git_diff"]
}

fn infer_target(goal: &str, context: &[AiContextReferencePayload]) -> String {
    if contains_any(&goal.to_lowercase(), &["timeline", "对话流"]) {
        return "Agent 对话流运行反馈".to_string();
    }

    if contains_any(&goal.to_lowercase(), &["计划", "待办", "折叠"]) {
        return "计划待办面板".to_string();
    }

    context
        .iter()
        .find(|reference| {
            matches!(
                reference.kind.as_str(),
                "current-file" | "selection" | "file"
            )
        })
        .map(|reference| {
            let label = reference.label.trim();
            if label.is_empty() {
                reference.path.as_deref().unwrap_or("当前任务").to_string()
            } else {
                label.to_string()
            }
        })
        .unwrap_or_else(|| goal.chars().take(24).collect::<String>())
}

fn contains_file_reference(context: &[AiContextReferencePayload]) -> bool {
    context.iter().any(|reference| {
        matches!(
            reference.kind.as_str(),
            "current-file" | "selection" | "file"
        )
    })
}

fn is_shell_script_target(target: &str, context: &[AiContextReferencePayload]) -> bool {
    let target_lower = target.to_lowercase();

    target_lower.ends_with(".sh")
        || target_lower.ends_with(".bash")
        || context.iter().any(|reference| {
            let label = reference.label.to_lowercase();
            let path = reference.path.as_deref().unwrap_or_default().to_lowercase();

            label.ends_with(".sh")
                || label.ends_with(".bash")
                || path.ends_with(".sh")
                || path.ends_with(".bash")
        })
}

fn plan_references(
    context: &[AiContextReferencePayload],
) -> Option<Vec<AiTaskPlanReferencePayload>> {
    let references = context
        .iter()
        .filter_map(|reference| {
            let uri = reference.path.as_deref()?.trim();
            if uri.is_empty() {
                return None;
            }

            let label = reference.label.trim();
            Some(AiTaskPlanReferencePayload {
                r#type: "file".to_string(),
                label: if label.is_empty() {
                    uri.to_string()
                } else {
                    label.to_string()
                },
                uri: uri.to_string(),
            })
        })
        .take(4)
        .collect::<Vec<_>>();

    (!references.is_empty()).then_some(references)
}

fn contains_any(value: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| value.contains(keyword))
}

fn with_references(
    mut step: AiTaskPlanStepPayload,
    references: &Option<Vec<AiTaskPlanReferencePayload>>,
) -> AiTaskPlanStepPayload {
    step.references = references.clone();
    step
}

fn build_step(
    index: usize,
    title: &str,
    goal: &str,
    kind: &str,
    risk_level: &str,
    tools: Vec<&str>,
    requires_user_approval: bool,
    expected_output: &str,
    rollback_strategy: Option<&str>,
) -> AiTaskPlanStepPayload {
    AiTaskPlanStepPayload {
        id: format!("plan-step-{}", index + 1),
        index,
        title: title.to_string(),
        goal: goal.to_string(),
        kind: kind.to_string(),
        status: "pending".to_string(),
        expected_output: expected_output.to_string(),
        tools: tools.into_iter().map(|item| item.to_string()).collect(),
        tool_inputs: None,
        references: None,
        is_active: None,
        requires_user_approval,
        risk_level: risk_level.to_string(),
        rollback_strategy: rollback_strategy.map(|item| item.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::AgentPlanner;
    use crate::commands::contracts::{
        AiAgentApprovePlanRequest, AiAgentClassifyTaskRequest, AiAgentPlanRequest,
        AiContextReferencePayload,
    };

    fn file_reference(path: &str) -> AiContextReferencePayload {
        AiContextReferencePayload {
            id: format!("ref-{path}"),
            kind: "file".to_string(),
            label: path.to_string(),
            path: Some(path.to_string()),
            range: None,
            content_preview: String::new(),
            redacted: false,
        }
    }

    fn current_file_reference(path: &str, label: &str) -> AiContextReferencePayload {
        AiContextReferencePayload {
            id: format!("current-file-{label}"),
            kind: "current-file".to_string(),
            label: label.to_string(),
            path: Some(path.to_string()),
            range: None,
            content_preview: "#!/usr/bin/env bash\n".to_string(),
            redacted: false,
        }
    }

    #[test]
    fn creates_complex_plan_with_two_to_six_steps() {
        let payload = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "接入 Agent Plan Mode".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");

        assert!((2..=6).contains(&payload.steps.len()));
        assert_eq!(payload.steps[0].index, 0);
        assert!(payload.steps.iter().all(|step| step.status == "pending"));
    }

    #[test]
    fn creates_contextual_plan_for_ui_flow_and_full_process_test_task() {
        let payload = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "把 run timeline 改成对话流里的实时活动，修复计划折叠按钮，并补全过程测试"
                .to_string(),
            context: vec![file_reference(
                "src/components/business/ai/AiAssistantPanel.vue",
            )],
        })
        .expect("contextual plan should be created");

        let titles = payload
            .steps
            .iter()
            .map(|step| step.title.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let expected_outputs = payload
            .steps
            .iter()
            .map(|step| step.expected_output.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(titles.contains("对话流"), "{titles}");
        assert!(titles.contains("折叠"), "{titles}");
        assert!(titles.contains("全过程测试"), "{titles}");
        assert!(
            expected_outputs.contains("用户提问与 AI 最终回答"),
            "{expected_outputs}"
        );
        assert!(
            payload
                .steps
                .iter()
                .any(|step| step.tools.iter().any(|tool| tool == "run_test")),
            "test-focused plan should include run_test"
        );
        assert!(
            !titles.contains("收集现有上下文与影响面"),
            "plan should not use the previous fixed template"
        );
        assert!(
            !titles.contains("真实触发链路"),
            "ui-flow plan should use task-specific wording: {titles}"
        );
    }

    #[test]
    fn creates_concrete_plan_for_current_shell_file_edit() {
        let payload = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "修改完善这个文件".to_string(),
            context: vec![current_file_reference("D:/workspace/test.sh", "test.sh")],
        })
        .expect("current file edit plan should be created");

        let titles = payload
            .steps
            .iter()
            .map(|step| step.title.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(titles.contains("读取 test.sh 脚本内容和诊断"), "{titles}");
        assert!(
            titles.contains("更新 test.sh 并保留 Patch 记录"),
            "{titles}"
        );
        assert!(titles.contains("运行 test.sh 的脚本最小验证"), "{titles}");
        assert!(
            !titles.contains("真实触发链路"),
            "current-file edit should not use bug-flow wording: {titles}"
        );
    }

    #[test]
    fn classifies_more_than_two_files_as_complex() {
        let payload = AgentPlanner::classify_task(AiAgentClassifyTaskRequest {
            goal: "调整样式".to_string(),
            context: vec![
                file_reference("src/a.ts"),
                file_reference("src/b.ts"),
                file_reference("src/c.ts"),
            ],
        })
        .expect("classification should succeed");

        assert_eq!(payload.classification, "complex");
        assert!(payload.should_enter_plan_mode);
    }

    #[test]
    fn rejects_plan_with_unknown_tool() {
        let mut plan = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "实现计划模式".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");
        plan.steps[0].tools = vec!["unknown_tool".to_string()];

        let error = AgentPlanner::approve_plan(AiAgentApprovePlanRequest {
            goal: "实现计划模式".to_string(),
            steps: plan.steps,
        })
        .expect_err("unknown tool should be rejected");

        assert!(error.contains("AI_AGENT_TOOL_NOT_ALLOWED"));
    }

    #[test]
    fn omits_null_optional_fields_from_plan_payload() {
        let payload = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "你修改一下".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");
        let value = serde_json::to_value(payload).expect("plan payload should serialize");
        let first_step = &value["steps"][0];

        assert!(first_step.get("toolInputs").is_none());
        assert!(first_step.get("references").is_none());
        assert!(first_step.get("isActive").is_none());
    }
}
