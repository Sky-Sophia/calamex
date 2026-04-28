<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        open: boolean;
        title: string;
        description: string;
        confirmText?: string;
    }>(),
    {
        confirmText: '知道了',
    },
);

const emit = defineEmits<{
    close: [];
    confirm: [];
}>();
</script>

<template>
    <Teleport to="body">
        <div v-if="props.open" class="ai-revert-confirm-dialog__backdrop" @click.self="emit('close')">
            <section class="ai-revert-confirm-dialog" role="alertdialog" aria-modal="true">
                <header class="ai-revert-confirm-dialog__header">
                    <h3>{{ props.title }}</h3>
                    <p>{{ props.description }}</p>
                </header>
                <footer class="ai-revert-confirm-dialog__actions">
                    <button type="button" class="ai-revert-confirm-dialog__button is-ghost" @click="emit('close')">
                        关闭
                    </button>
                    <button type="button" class="ai-revert-confirm-dialog__button is-primary" @click="emit('confirm')">
                        {{ props.confirmText }}
                    </button>
                </footer>
            </section>
        </div>
    </Teleport>
</template>

<style scoped>
.ai-revert-confirm-dialog__backdrop {
    position: fixed;
    inset: 0;
    z-index: 1500;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, #030712 72%, transparent);
}

.ai-revert-confirm-dialog {
    width: min(420px, calc(100vw - 32px));
    border-radius: 20px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 80%, transparent);
    background: color-mix(in srgb, var(--shell-panel) 92%, transparent);
    padding: 18px;
    box-shadow: 0 24px 64px rgb(0 0 0 / 28%);
}

.ai-revert-confirm-dialog__header {
    display: grid;
    gap: 8px;
}

.ai-revert-confirm-dialog__header h3 {
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 700;
}

.ai-revert-confirm-dialog__header p {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
}

.ai-revert-confirm-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 18px;
}

.ai-revert-confirm-dialog__button {
    border-radius: 12px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
}

.ai-revert-confirm-dialog__button.is-ghost {
    border: 1px solid color-mix(in srgb, var(--shell-divider) 80%, transparent);
    color: var(--text-secondary);
}

.ai-revert-confirm-dialog__button.is-primary {
    background: color-mix(in srgb, var(--accent-primary) 72%, #2563eb);
    color: white;
}
</style>