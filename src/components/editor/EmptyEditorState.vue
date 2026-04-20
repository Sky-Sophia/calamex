<template>
    <div class="empty-editor-state">
        <section class="empty-editor-state__layout">
            <div class="empty-editor-state__hero">
                <div class="empty-editor-state__mini" aria-hidden="true">
                    <div class="empty-editor-state__mini-bar">
                        <span v-for="dot in 3" :key="dot" class="empty-editor-state__mini-dot" />
                    </div>

                    <div class="empty-editor-state__mini-body">
                        <div class="empty-editor-state__line-numbers">
                            <span v-for="lineNumber in previewLineNumbers" :key="lineNumber">{{ lineNumber }}</span>
                        </div>

                        <div class="empty-editor-state__rows">
                            <div v-for="(row, index) in previewRows" :key="index" class="empty-editor-state__row"
                                :class="[row.widthClass, row.indentClass, row.toneClass]" />

                            <div class="empty-editor-state__caret-row">
                                <span class="empty-editor-state__caret" />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="empty-editor-state__copy">
                    <h2 class="text-[13px] font-medium tracking-[0.02em] text-(--text-primary)">未打开文件</h2>
                    <p class="mt-1 max-w-md text-[12px] leading-6 text-(--text-secondary)">
                        {{ description }}
                    </p>
                </div>
            </div>

            <div class="empty-editor-state__toolbar">
                <div class="flex flex-wrap items-center gap-2.5">
                    <Button size="sm" class="empty-editor-state__action" @click="emit('create')">
                        新建文档
                    </Button>
                    <Button variant="outline" size="sm" class="empty-editor-state__action" @click="emit('open')">
                        打开文件
                    </Button>
                    <Button v-if="showOpenFolderAction" variant="ghost" size="sm" class="empty-editor-state__action"
                        @click="emit('open-folder')">
                        打开文件夹
                    </Button>
                </div>

                <div class="empty-editor-state__hotkeys" aria-hidden="true">
                    <span class="empty-editor-state__hotkey-item">
                        新建
                        <kbd>Ctrl</kbd>
                        <kbd>N</kbd>
                    </span>
                    <span class="empty-editor-state__hotkey-item">
                        打开
                        <kbd>Ctrl</kbd>
                        <kbd>O</kbd>
                    </span>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { computed } from 'vue';

const props = defineProps<{
    hasWorkspace: boolean;
    isDesktopRuntime: boolean;
}>();

const emit = defineEmits<{
    create: [];
    open: [];
    'open-folder': [];
}>();

const previewLineNumbers = ['1', '2', '3', '4', '5'] as const;

const previewRows = [
    { widthClass: 'w-[40%]', indentClass: '', toneClass: 'is-accent' },
    { widthClass: 'w-[64%]', indentClass: '', toneClass: 'is-secondary' },
    { widthClass: 'w-[48%]', indentClass: 'ml-2', toneClass: 'is-soft' },
    { widthClass: 'w-[54%]', indentClass: 'ml-4', toneClass: 'is-muted' },
] as const;

const description = computed(() => {
    if (props.hasWorkspace) {
        return '从左侧资源管理器选择文件，或新建一份空白文档。';
    }

    if (props.isDesktopRuntime) {
        return '打开文件或文件夹，或新建一份空白文档。';
    }

    return '打开一份本地文件，或新建一份空白文档。';
});

const showOpenFolderAction = computed(() => props.isDesktopRuntime && !props.hasWorkspace);
</script>

<style scoped>
.empty-editor-state {
    display: flex;
    min-height: 100%;
    justify-content: center;
    overflow: auto;
    padding: 52px 32px 24px;
}

.empty-editor-state__layout {
    width: min(100%, 720px);
}

.empty-editor-state__hero {
    display: flex;
    align-items: flex-start;
    gap: 18px;
}

.empty-editor-state__copy {
    padding-top: 2px;
}

.empty-editor-state__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px 18px;
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--border-subtle);
}

.empty-editor-state__mini {
    position: relative;
    width: 112px;
    height: 76px;
    overflow: hidden;
    flex: none;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015)),
        var(--panel-muted);
    box-shadow: 0 10px 28px -14px rgba(0, 0, 0, 0.56);
}

.empty-editor-state__mini-bar {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 14px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(0, 0, 0, 0.12);
}

.empty-editor-state__mini-dot {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: var(--text-quaternary);
    opacity: 0.7;
}

.empty-editor-state__mini-body {
    position: relative;
    padding: 8px 8px 8px 18px;
}

.empty-editor-state__line-numbers {
    position: absolute;
    top: 8px;
    left: 6px;
    display: flex;
    width: 8px;
    flex-direction: column;
    gap: 4px;
    color: var(--text-quaternary);
    font-family: var(--font-mono);
    font-size: 7px;
    line-height: 1;
    text-align: right;
}

.empty-editor-state__rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.empty-editor-state__row,
.empty-editor-state__caret-row {
    height: 3px;
    border-radius: 999px;
}

.empty-editor-state__row.is-accent {
    background: var(--accent-strong);
    opacity: 0.46;
}

.empty-editor-state__row.is-secondary {
    background: var(--text-tertiary);
    opacity: 0.4;
}

.empty-editor-state__row.is-soft {
    background: var(--text-quaternary);
    opacity: 0.26;
}

.empty-editor-state__row.is-muted {
    background: var(--text-quaternary);
    opacity: 0.34;
}

.empty-editor-state__caret-row {
    width: 10%;
    background: transparent;
}

.empty-editor-state__caret {
    display: inline-block;
    width: 1px;
    height: 5px;
    background: var(--accent-strong);
    vertical-align: -1px;
    animation: empty-editor-caret-blink 1.1s steps(2, start) infinite;
}

.empty-editor-state__action {
    min-width: 96px;
}

.empty-editor-state__hotkeys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    color: var(--text-quaternary);
    font-size: 11.5px;
}

.empty-editor-state__hotkey-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.empty-editor-state__hotkey-item kbd {
    padding: 1px 5px;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.2;
}

@keyframes empty-editor-caret-blink {
    to {
        opacity: 0;
    }
}

@media (max-width: 640px) {
    .empty-editor-state {
        padding: 36px 20px 20px;
    }

    .empty-editor-state__hero,
    .empty-editor-state__toolbar {
        flex-direction: column;
        align-items: flex-start;
    }
}

@media (prefers-reduced-motion: reduce) {
    .empty-editor-state__caret {
        animation: none;
    }
}
</style>