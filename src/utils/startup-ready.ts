export const WORKBENCH_READY_EVENT = 'sh:workbench-ready';

export const dispatchWorkbenchReadyEvent = (): void => {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new Event(WORKBENCH_READY_EVENT));
};