import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import { useAiEditStore } from '@/store/aiEdit';
import type { IAiEditListTimelineRequest } from '@/types/ai-edit';

export const useAiEditTimeline = () => {
    const store = useAiEditStore();
    const { timelineEntries, status, errorMessage } = storeToRefs(store);

    const hasEntries = computed<boolean>(() => timelineEntries.value.length > 0);

    const loadTimeline = (payload: IAiEditListTimelineRequest = {}): Promise<unknown> =>
        store.loadTimeline(payload);

    return {
        timelineEntries,
        hasEntries,
        status,
        errorMessage,
        loadTimeline,
        clearTimeline: store.clearTimeline,
    };
};