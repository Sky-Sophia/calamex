import { z } from 'zod';
import {
  aiEditAuthStateSchema,
  aiEditCreateSnapshotPayloadSchema,
  aiEditCreateSnapshotRequestSchema,
  aiEditGetDiffPayloadSchema,
  aiEditGetDiffRequestSchema,
  aiEditListTimelinePayloadSchema,
  aiEditListTimelineRequestSchema,
  aiEditRestoreSnapshotPayloadSchema,
  aiEditRestoreSnapshotRequestSchema,
  aiEditRevertFilePayloadSchema,
  aiEditRevertFileRequestSchema,
  aiEditRevertHunkPayloadSchema,
  aiEditRevertHunkRequestSchema,
  aiEditRevertTaskPayloadSchema,
  aiEditRevertTaskRequestSchema,
  aiEditSetAuthLevelRequestSchema,
  aiEditSetPinPayloadSchema,
  aiEditSetPinRequestSchema,
  aiEditUndoOperationPayloadSchema,
  aiEditUndoOperationRequestSchema,
} from '@/types/ai/edit.schema';
import {
  aiAgentClassifyTaskPayloadSchema,
  aiAgentClassifyTaskRequestSchema,
  aiAgentNetworkPermissionPayloadSchema,
  aiAgentSetNetworkPermissionRequestSchema,
  aiApplyPatchMetadataSchema,
  aiChatRequestSchema,
  aiChatStreamPayloadSchema,
  aiConfigPayloadSchema,
  aiConversationTitlePayloadSchema,
  aiConversationTitleRequestSchema,
  aiModelRoleSchema,
  aiPatchSetSchema,
  aiProviderConnectionPayloadSchema,
  aiProviderConnectionRequestSchema,
  aiProviderTestPayloadSchema,
  aiProviderTypeSchema,
  aiSuggestionPoolPayloadSchema,
  aiSuggestionPoolRequestSchema,
  aiWebFetchInputSchema,
  aiWebFetchPayloadSchema,
  aiWebSearchInputSchema,
  aiWebSearchPayloadSchema,
} from '@/types/ai/schema';
import {
  agentSidecarApprovalResolveRequestSchema,
  agentSidecarChatRequestSchema,
  agentSidecarCheckpointRestoreRequestSchema,
  agentSidecarExecuteRequestSchema,
  agentSidecarHealthPayloadSchema,
  agentSidecarPlanApproveRequestSchema,
  agentSidecarPlanFinishRequestSchema,
  agentSidecarPlanQueryRequestSchema,
  agentSidecarPlanRejectRequestSchema,
  agentSidecarPlanReplanRequestSchema,
  agentSidecarPlanRequestSchema,
  agentSidecarPlanValidateRequestSchema,
  agentSidecarResponsePayloadSchema,
  agentSidecarWarmupPayloadSchema,
} from '@/types/ai/sidecar.schema';

/**
 * @deprecated Tauri invoke 契约正在迁移到 tauri-specta 生成绑定。
 * 新增或迁移后的 Tauri invoke 路径不得在这里继续维护手写 Zod contract。
 */
export const zTauriVoid = z
  .union([z.null(), z.undefined(), z.void()])
  .transform(() => undefined as void);

export const tauriContracts = {
  agentSidecarHealth: {
    inSchema: z.void(),
    outSchema: agentSidecarHealthPayloadSchema,
  },
  agentSidecarRestart: {
    inSchema: z.void(),
    outSchema: agentSidecarHealthPayloadSchema,
  },
  agentSidecarWarmup: {
    inSchema: z.void(),
    outSchema: agentSidecarWarmupPayloadSchema,
  },
  agentSidecarChat: {
    inSchema: agentSidecarChatRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarPlan: {
    inSchema: agentSidecarPlanRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarPlanApprove: {
    inSchema: agentSidecarPlanApproveRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarPlanQuery: {
    inSchema: agentSidecarPlanQueryRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarPlanReject: {
    inSchema: agentSidecarPlanRejectRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarPlanFinish: {
    inSchema: agentSidecarPlanFinishRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarPlanValidate: {
    inSchema: agentSidecarPlanValidateRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarPlanReplan: {
    inSchema: agentSidecarPlanReplanRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarExecute: {
    inSchema: agentSidecarExecuteRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarResolveApproval: {
    inSchema: agentSidecarApprovalResolveRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  agentSidecarRestoreCheckpoint: {
    inSchema: agentSidecarCheckpointRestoreRequestSchema,
    outSchema: agentSidecarResponsePayloadSchema,
  },
  aiGetConfig: {
    inSchema: z.void(),
    outSchema: aiConfigPayloadSchema,
  },
  aiSaveConfig: {
    inSchema: z.object({
      role: aiModelRoleSchema.optional(),
      providerType: aiProviderTypeSchema,
      selectedModel: z.string().nullable(),
      baseUrl: z.string().nullable(),
      inlineCompletionEnabled: z.boolean(),
      chatEnabled: z.boolean(),
      agentEnabled: z.boolean(),
    }),
    outSchema: aiConfigPayloadSchema,
  },
  aiSaveCredentials: {
    inSchema: z.object({
      providerId: z.string().min(1),
      apiKey: z.string().min(1),
    }),
    outSchema: aiConfigPayloadSchema,
  },
  aiTestProviderConfig: {
    inSchema: aiProviderConnectionRequestSchema,
    outSchema: aiProviderTestPayloadSchema,
  },
  aiConnectProvider: {
    inSchema: aiProviderConnectionRequestSchema,
    outSchema: aiProviderConnectionPayloadSchema,
  },
  aiClearCredentials: {
    inSchema: z.void(),
    outSchema: zTauriVoid,
  },
  aiTestProvider: {
    inSchema: z.void(),
    outSchema: aiProviderTestPayloadSchema,
  },
  aiGenerateConversationTitle: {
    inSchema: aiConversationTitleRequestSchema,
    outSchema: aiConversationTitlePayloadSchema,
  },
  aiGetSuggestionPoolCache: {
    inSchema: z.void(),
    outSchema: aiSuggestionPoolPayloadSchema.nullable(),
  },
  aiGenerateSuggestionPool: {
    inSchema: aiSuggestionPoolRequestSchema,
    outSchema: aiSuggestionPoolPayloadSchema,
  },
  aiChatStream: {
    inSchema: aiChatRequestSchema,
    outSchema: aiChatStreamPayloadSchema,
  },
  aiCancel: {
    inSchema: z.object({
      streamId: z.string().min(1),
    }),
    outSchema: zTauriVoid,
  },
  aiInlineComplete: {
    inSchema: z.object({
      filePath: z.string(),
      language: z.string(),
      cursorOffset: z.number().int().nonnegative(),
      prefix: z.string(),
      suffix: z.string(),
      recentEdits: z.array(z.string()).optional(),
    }),
    outSchema: z.object({
      insertText: z.string(),
      range: z.object({
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().nonnegative(),
      }),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  },
  aiAgentClassifyTask: {
    inSchema: aiAgentClassifyTaskRequestSchema,
    outSchema: aiAgentClassifyTaskPayloadSchema,
  },
  aiAgentSetNetworkPermission: {
    inSchema: aiAgentSetNetworkPermissionRequestSchema,
    outSchema: aiAgentNetworkPermissionPayloadSchema,
  },
  aiWebSearch: {
    inSchema: aiWebSearchInputSchema,
    outSchema: aiWebSearchPayloadSchema,
  },
  aiWebFetch: {
    inSchema: aiWebFetchInputSchema,
    outSchema: aiWebFetchPayloadSchema,
  },
  aiProposePatch: {
    inSchema: z.object({
      path: z.string().min(1),
      originalContent: z.string(),
      updatedContent: z.string(),
      summary: z.string(),
    }),
    outSchema: z.object({
      patch: aiPatchSetSchema,
    }),
  },
  aiApplyPatch: {
    inSchema: z.object({
      patch: aiPatchSetSchema,
      metadata: aiApplyPatchMetadataSchema.optional(),
    }),
    outSchema: z.object({
      appliedFiles: z.array(
        z.object({
          path: z.string(),
          byteSize: z.number().int().nonnegative(),
        }),
      ),
    }),
  },
  aiEditGetAuthLevel: {
    inSchema: z.void(),
    outSchema: aiEditAuthStateSchema,
  },
  aiEditSetAuthLevel: {
    inSchema: aiEditSetAuthLevelRequestSchema,
    outSchema: aiEditAuthStateSchema,
  },
  aiEditListTimeline: {
    inSchema: aiEditListTimelineRequestSchema,
    outSchema: aiEditListTimelinePayloadSchema,
  },
  aiEditCreateSnapshot: {
    inSchema: aiEditCreateSnapshotRequestSchema,
    outSchema: aiEditCreateSnapshotPayloadSchema,
  },
  aiEditSetPin: {
    inSchema: aiEditSetPinRequestSchema,
    outSchema: aiEditSetPinPayloadSchema,
  },
  aiEditGetDiff: {
    inSchema: aiEditGetDiffRequestSchema,
    outSchema: aiEditGetDiffPayloadSchema,
  },
  aiEditRestoreSnapshot: {
    inSchema: aiEditRestoreSnapshotRequestSchema,
    outSchema: aiEditRestoreSnapshotPayloadSchema,
  },
  aiEditUndoOperation: {
    inSchema: aiEditUndoOperationRequestSchema,
    outSchema: aiEditUndoOperationPayloadSchema,
  },
  aiEditRevertFile: {
    inSchema: aiEditRevertFileRequestSchema,
    outSchema: aiEditRevertFilePayloadSchema,
  },
  aiEditRevertHunk: {
    inSchema: aiEditRevertHunkRequestSchema,
    outSchema: aiEditRevertHunkPayloadSchema,
  },
  aiEditRevertTask: {
    inSchema: aiEditRevertTaskRequestSchema,
    outSchema: aiEditRevertTaskPayloadSchema,
  },
} as const;
