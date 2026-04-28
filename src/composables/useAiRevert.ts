import { aiEditService } from '@/services/modules/ai-edit';
import { useAiEditStore } from '@/store/aiEdit';
import type {
    IAiEditRestoreSnapshotPayload,
    IAiEditRevertTaskPayload,
    IAiEditUndoOperationPayload,
} from '@/types/ai-edit';
import { AppError, isAppError } from '@/types/app-error';
import { computed, ref } from 'vue';

interface IAiRevertFailureResult {
    data: null;
    error: AppError;
    status: 'failed';
}

interface IAiRevertSuccessResult<TData> {
    data: TData;
    error: null;
    status: 'success';
}

type TAiRevertActionResult<TData> = IAiRevertFailureResult | IAiRevertSuccessResult<TData>;

const createNotReadyError = (action: string): AppError =>
    new AppError({
        code: 'AI_EDIT_REVERT_NOT_READY',
        message: `AED 回滚能力尚未接入：${action}`,
        scope: 'ipc',
        traceId: `ai-edit-revert-${action}`,
    });

export const useAiRevert = () => {
    const store = useAiEditStore();
    const isReverting = ref(false);
    const error = ref<AppError | null>(null);
    const canUndo = computed<boolean>(() => true);
    const canRestoreSnapshot = computed<boolean>(() => true);
    const isSupported = canRestoreSnapshot;

    const runNotReadyAction = async (action: string): Promise<IAiRevertFailureResult> => {
        isReverting.value = true;
        const nextError = createNotReadyError(action);
        error.value = nextError;
        isReverting.value = false;
        return {
            data: null,
            error: nextError,
            status: 'failed',
        };
    };

    const normalizeError = (value: unknown, action: string): AppError => {
        if (isAppError(value)) {
            return value;
        }

        if (value instanceof Error) {
            return new AppError({
                code: 'AI_EDIT_RESTORE_FAILED',
                message: value.message,
                scope: 'ipc',
                traceId: `ai-edit-revert-${action}`,
                cause: value,
            });
        }

        return new AppError({
            code: 'AI_EDIT_RESTORE_FAILED',
            message: `AED 恢复失败：${action}`,
            scope: 'ipc',
            traceId: `ai-edit-revert-${action}`,
            cause: value,
        });
    };

    const restoreSnapshot = async (
        snapshotId: string,
    ): Promise<TAiRevertActionResult<IAiEditRestoreSnapshotPayload>> => {
        isReverting.value = true;
        error.value = null;

        try {
            const data = await aiEditService.restoreSnapshot({ snapshotId });
            await store.loadTimeline().catch(() => undefined);
            return {
                data,
                error: null,
                status: 'success',
            };
        } catch (value) {
            const nextError = normalizeError(value, `restore-snapshot:${snapshotId}`);
            error.value = nextError;
            return {
                data: null,
                error: nextError,
                status: 'failed',
            };
        } finally {
            isReverting.value = false;
        }
    };

    const undoOperation = async (
        operationId: string,
    ): Promise<TAiRevertActionResult<IAiEditUndoOperationPayload>> => {
        isReverting.value = true;
        error.value = null;

        try {
            const data = await aiEditService.undoOperation({ operationId });
            await store.loadTimeline().catch(() => undefined);
            return {
                data,
                error: null,
                status: 'success',
            };
        } catch (value) {
            const nextError = normalizeError(value, `undo-operation:${operationId}`);
            error.value = nextError;
            return {
                data: null,
                error: nextError,
                status: 'failed',
            };
        } finally {
            isReverting.value = false;
        }
    };

    const revertTask = async (
        taskId: string,
    ): Promise<TAiRevertActionResult<IAiEditRevertTaskPayload>> => {
        isReverting.value = true;
        error.value = null;

        try {
            const data = await aiEditService.revertTask({ taskId });
            await store.loadTimeline().catch(() => undefined);
            return {
                data,
                error: null,
                status: 'success',
            };
        } catch (value) {
            const nextError = normalizeError(value, `revert-task:${taskId}`);
            error.value = nextError;
            return {
                data: null,
                error: nextError,
                status: 'failed',
            };
        } finally {
            isReverting.value = false;
        }
    };

    return {
        isSupported,
        canUndo,
        canRestoreSnapshot,
        isReverting,
        error,
        undoLastEdit: (): Promise<IAiRevertFailureResult> => runNotReadyAction('undo-last'),
        undoOperation,
        revertTask,
        restoreSnapshot,
    };
};