import { aiEditService } from '@/services/modules/ai-edit';
import type {
    IAiEditAuthState,
    IAiEditListTimelineRequest,
    IAiEditSetAuthLevelRequest,
    IAiEditTimelineEntry,
    TAiEditAuthLevel,
} from '@/types/ai-edit';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

type TAiEditStoreStatus = 'idle' | 'loading' | 'error';

const createDefaultAuthState = (): IAiEditAuthState => ({
    level: 'manual',
    taskId: null,
    updatedAt: new Date(0).toISOString(),
});

export const useAiEditStore = defineStore('ai-edit', () => {
    const authState = ref<IAiEditAuthState>(createDefaultAuthState());
    const timelineEntries = ref<IAiEditTimelineEntry[]>([]);
    const status = ref<TAiEditStoreStatus>('idle');
    const errorMessage = ref<string | null>(null);

    const authLevel = computed<TAiEditAuthLevel>(() => authState.value.level);
    const isAutoApplyEnabled = computed<boolean>(() => authLevel.value !== 'manual');
    const hasTimelineEntries = computed<boolean>(() => timelineEntries.value.length > 0);

    const setStatus = (nextStatus: TAiEditStoreStatus, message: string | null = null): void => {
        status.value = nextStatus;
        errorMessage.value = message;
    };

    const applyAuthState = (nextState: IAiEditAuthState): IAiEditAuthState => {
        authState.value = nextState;
        return authState.value;
    };

    const loadAuthState = async (): Promise<IAiEditAuthState> => {
        setStatus('loading');
        try {
            const nextState = await aiEditService.getAuthLevel();
            setStatus('idle');
            return applyAuthState(nextState);
        } catch (error) {
            setStatus('error', error instanceof Error ? error.message : '读取 AED 授权状态失败。');
            throw error;
        }
    };

    const setAuthLevel = async (
        payload: IAiEditSetAuthLevelRequest,
    ): Promise<IAiEditAuthState> => {
        setStatus('loading');
        try {
            const nextState = await aiEditService.setAuthLevel(payload);
            setStatus('idle');
            return applyAuthState(nextState);
        } catch (error) {
            setStatus('error', error instanceof Error ? error.message : '设置 AED 授权状态失败。');
            throw error;
        }
    };

    const loadTimeline = async (
        payload: IAiEditListTimelineRequest = {},
    ): Promise<IAiEditTimelineEntry[]> => {
        setStatus('loading');
        try {
            const nextTimeline = await aiEditService.listTimeline(payload);
            timelineEntries.value = nextTimeline.entries;
            setStatus('idle');
            return timelineEntries.value;
        } catch (error) {
            setStatus('error', error instanceof Error ? error.message : '读取 AED 时间线失败。');
            throw error;
        }
    };

    const clearTimeline = (): void => {
        timelineEntries.value = [];
    };

    return {
        authState,
        timelineEntries,
        status,
        errorMessage,
        authLevel,
        isAutoApplyEnabled,
        hasTimelineEntries,
        loadAuthState,
        setAuthLevel,
        loadTimeline,
        clearTimeline,
        setStatus,
    };
});