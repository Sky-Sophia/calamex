import { tauriService } from '@/services/tauri';
import type {
    IAiEditAuthState,
    IAiEditListTimelinePayload,
    IAiEditListTimelineRequest,
    IAiEditRestoreSnapshotPayload,
    IAiEditRestoreSnapshotRequest,
    IAiEditRevertTaskPayload,
    IAiEditRevertTaskRequest,
    IAiEditSetAuthLevelRequest,
    IAiEditUndoOperationPayload,
    IAiEditUndoOperationRequest,
} from '@/types/ai-edit';

export const aiEditService = {
    getAuthLevel(): Promise<IAiEditAuthState> {
        return tauriService.aiEditGetAuthLevel();
    },
    setAuthLevel(payload: IAiEditSetAuthLevelRequest): Promise<IAiEditAuthState> {
        return tauriService.aiEditSetAuthLevel(payload);
    },
    listTimeline(payload: IAiEditListTimelineRequest = {}): Promise<IAiEditListTimelinePayload> {
        return tauriService.aiEditListTimeline(payload);
    },
    restoreSnapshot(
        payload: IAiEditRestoreSnapshotRequest,
    ): Promise<IAiEditRestoreSnapshotPayload> {
        return tauriService.aiEditRestoreSnapshot(payload);
    },
    undoOperation(
        payload: IAiEditUndoOperationRequest,
    ): Promise<IAiEditUndoOperationPayload> {
        return tauriService.aiEditUndoOperation(payload);
    },
    revertTask(payload: IAiEditRevertTaskRequest): Promise<IAiEditRevertTaskPayload> {
        return tauriService.aiEditRevertTask(payload);
    },
};