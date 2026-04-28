import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import { useAiConversationStore } from '@/store/aiConversation';
import { useAiEditStore } from '@/store/aiEdit';
import type { IAiEditSetAuthLevelRequest, TAiEditAuthLevel } from '@/types/ai-edit';

export const useAiAutoApply = () => {
    const conversationStore = useAiConversationStore();
    const store = useAiEditStore();
    const { authState, status, errorMessage } = storeToRefs(store);

    const authLevel = computed<TAiEditAuthLevel>(() => authState.value.level);
    const isAutoApplyEnabled = computed<boolean>(() => authLevel.value !== 'manual');
    const activeTaskId = computed<string | null>(() => conversationStore.activeThreadId);

    const loadAuthState = (): Promise<unknown> => store.loadAuthState();

    const setAuthLevel = (payload: IAiEditSetAuthLevelRequest): Promise<unknown> =>
        store.setAuthLevel({
            ...payload,
            taskId:
                payload.level === 'per_task'
                    ? payload.taskId ?? activeTaskId.value
                    : payload.taskId,
        });

    return {
        authState,
        authLevel,
        activeTaskId,
        isAutoApplyEnabled,
        status,
        errorMessage,
        loadAuthState,
        setAuthLevel,
    };
};