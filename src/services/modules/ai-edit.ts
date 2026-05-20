import { tauriService } from '@/services/tauri';
import type {
    IAiEditAuthState,
    IAiEditCreateSnapshotPayload,
    IAiEditCreateSnapshotRequest,
    IAiEditGetDiffPayload,
    IAiEditGetDiffRequest,
    IAiEditListTimelinePayload,
    IAiEditListTimelineRequest,
    IAiEditRestoreSnapshotPayload,
    IAiEditRestoreSnapshotRequest,
    IAiEditRevertFilePayload,
    IAiEditRevertFileRequest,
    IAiEditRevertHunkPayload,
    IAiEditRevertHunkRequest,
    IAiEditRevertTaskPayload,
    IAiEditRevertTaskRequest,
    IAiEditSetAuthLevelRequest,
    IAiEditSetPinPayload,
    IAiEditSetPinRequest,
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
    createSnapshot(
        payload: IAiEditCreateSnapshotRequest,
    ): Promise<IAiEditCreateSnapshotPayload> {
        return tauriService.aiEditCreateSnapshot(payload);
    },
    setPin(payload: IAiEditSetPinRequest): Promise<IAiEditSetPinPayload> {
        return tauriService.aiEditSetPin(payload);
    },
    getDiff(payload: IAiEditGetDiffRequest): Promise<IAiEditGetDiffPayload> {
        return tauriService.aiEditGetDiff(payload);
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
    revertFile(payload: IAiEditRevertFileRequest): Promise<IAiEditRevertFilePayload> {
        return tauriService.aiEditRevertFile(payload);
    },
    revertHunk(payload: IAiEditRevertHunkRequest): Promise<IAiEditRevertHunkPayload> {
        return tauriService.aiEditRevertHunk(payload);
    },
    revertTask(payload: IAiEditRevertTaskRequest): Promise<IAiEditRevertTaskPayload> {
        return tauriService.aiEditRevertTask(payload);
    },
};
