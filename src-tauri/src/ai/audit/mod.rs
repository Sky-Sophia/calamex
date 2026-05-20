use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[allow(dead_code)]
#[serde(rename_all = "kebab-case")]
pub enum AiAuditEventKind {
    ChatStarted,
    ChatCompleted,
    ChatFailed,
    AgentPlanCreated,
    AgentPlanUpdated,
    AgentPlanApproved,
    AgentPlanRejected,
    AgentRunStarted,
    AgentRunCompleted,
    AgentRunFailed,
    AgentStepStarted,
    AgentStepCompleted,
    AgentStepFailed,
    AgentStepRetried,
    AgentWebSearchRequested,
    AgentWebSearchApproved,
    AgentWebSearchDenied,
    AgentWebFetchRequested,
    AgentWebFetchCompleted,
    AgentWebFetchFailed,
    AgentReplanned,
    AgentPermissionChanged,
    ConfigUpdated,
    CredentialCleared,
    AiEditAuthChanged,
    AiEditApplied,
    AiEditCheckpointCreated,
    AiEditPruned,
    AiEditOperationReverted,
    AiEditFileReverted,
    AiEditHunkReverted,
    AiEditSnapshotRestored,
    AiEditTaskReverted,
    PatchProposed,
    PatchApplied,
    PatchFailed,
    SecretDetected,
}

impl AiAuditEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ChatStarted => "ai.chat.started",
            Self::ChatCompleted => "ai.chat.completed",
            Self::ChatFailed => "ai.chat.failed",
            Self::AgentPlanCreated => "ai.agent.plan.created",
            Self::AgentPlanUpdated => "ai.agent.plan.updated",
            Self::AgentPlanApproved => "ai.agent.plan.approved",
            Self::AgentPlanRejected => "ai.agent.plan.rejected",
            Self::AgentRunStarted => "ai.agent.run.started",
            Self::AgentRunCompleted => "ai.agent.run.completed",
            Self::AgentRunFailed => "ai.agent.run.failed",
            Self::AgentStepStarted => "ai.agent.step.started",
            Self::AgentStepCompleted => "ai.agent.step.completed",
            Self::AgentStepFailed => "ai.agent.step.failed",
            Self::AgentStepRetried => "ai.agent.step.retried",
            Self::AgentWebSearchRequested => "ai.agent.web_search.requested",
            Self::AgentWebSearchApproved => "ai.agent.web_search.approved",
            Self::AgentWebSearchDenied => "ai.agent.web_search.denied",
            Self::AgentWebFetchRequested => "ai.agent.web_fetch.requested",
            Self::AgentWebFetchCompleted => "ai.agent.web_fetch.completed",
            Self::AgentWebFetchFailed => "ai.agent.web_fetch.failed",
            Self::AgentReplanned => "ai.agent.replanned",
            Self::AgentPermissionChanged => "ai.agent.permission.changed",
            Self::ConfigUpdated => "ai.config.updated",
            Self::CredentialCleared => "ai.credential.cleared",
            Self::AiEditAuthChanged => "ai.edit.auth_changed",
            Self::AiEditApplied => "ai.edit.applied",
            Self::AiEditCheckpointCreated => "ai.edit.checkpoint_created",
            Self::AiEditPruned => "ai.edit.pruned",
            Self::AiEditOperationReverted => "ai.edit.operation_reverted",
            Self::AiEditFileReverted => "ai.edit.file_reverted",
            Self::AiEditHunkReverted => "ai.edit.hunk_reverted",
            Self::AiEditSnapshotRestored => "ai.edit.snapshot_restored",
            Self::AiEditTaskReverted => "ai.edit.task_reverted",
            Self::PatchProposed => "ai.patch.proposed",
            Self::PatchApplied => "ai.patch.applied",
            Self::PatchFailed => "ai.patch.failed",
            Self::SecretDetected => "ai.secret.detected",
        }
    }
}

pub fn emit(event: AiAuditEventKind) {
    tracing::info!(target: "ai.audit", event = event.as_str(), "AI audit event");
}
