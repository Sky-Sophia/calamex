<template>
  <DialogRoot :open="Boolean(dialogState)" @update:open="handleOpenChange">
    <DialogPortal v-if="dialogState">
      <DialogOverlay class="app-dialog-overlay" />
      <DialogContent ref="dialogPanelRef" class="app-dialog-panel" role="alertdialog" aria-modal="true" tabindex="-1"
        :data-variant="dialogState.variant" :aria-labelledby="titleId" :aria-describedby="descriptionId"
        @open-auto-focus="handleOpenAutoFocus">
        <div class="app-dialog-copy">
          <DialogTitle :id="titleId" class="app-dialog-title">
            {{ dialogState.title }}
          </DialogTitle>
          <DialogDescription :id="descriptionId" class="app-dialog-description">
            {{ dialogState.description }}
          </DialogDescription>
        </div>
        <div class="app-dialog-footer">
          <Button variant="ghost" size="sm" class="app-dialog-button app-dialog-secondary-button"
            @click="handleAction('cancel')">
            {{ dialogState.cancelText }}
          </Button>
          <Button variant="ghost" size="sm" class="app-dialog-button app-dialog-secondary-button"
            @click="handleAction('dismiss')">
            {{ dialogState.dismissText }}
          </Button>
          <Button size="sm" class="app-dialog-button app-dialog-primary-button" @click="handleAction('confirm')">
            {{ dialogState.confirmText }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  APP_DIALOG_DISMISS_EVENT,
  APP_DIALOG_EVENT,
  type IAppDialogDismissDetail,
  type IAppDialogEventDetail,
  type TAppDialogAction,
  type TAppDialogVariant,
} from '@/types/dialog';
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';

type TResolvedDialogState = {
  id: string;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  dismissText: string;
  variant: TAppDialogVariant;
  onAction: (action: TAppDialogAction) => void;
};

const dialogState = ref<TResolvedDialogState | null>(null);
const dialogPanelRef = ref<HTMLElement | { $el?: HTMLElement } | null>(null);

const baseId = useId();
const titleId = `${baseId}-title`;
const descriptionId = `${baseId}-description`;

const getDialogPanelElement = (): HTMLElement | null => {
  if (dialogPanelRef.value instanceof HTMLElement) {
    return dialogPanelRef.value;
  }

  return dialogPanelRef.value?.$el ?? null;
};

const focusDialogPanel = async (): Promise<void> => {
  await nextTick();
  getDialogPanelElement()?.focus();
};

const resolveDialogState = (detail: IAppDialogEventDetail): TResolvedDialogState => ({
  id: detail.id ?? `${baseId}-${Date.now()}`,
  title: detail.title,
  description: detail.description,
  confirmText: detail.confirmText ?? '确认',
  cancelText: detail.cancelText ?? '取消',
  dismissText: detail.dismissText ?? '返回',
  variant: detail.variant ?? 'default',
  onAction: detail.onAction,
});

const handleAction = (action: TAppDialogAction): void => {
  const current = dialogState.value;
  if (!current) {
    return;
  }
  dialogState.value = null;
  current.onAction(action);
};

const handleDialogEvent = (event: Event): void => {
  const customEvent = event as CustomEvent<IAppDialogEventDetail>;
  const detail = customEvent.detail;
  if (!detail) {
    return;
  }
  const previous = dialogState.value;
  dialogState.value = resolveDialogState(detail);
  if (previous) {
    previous.onAction('dismiss');
  }
  void focusDialogPanel();
};

const handleDialogDismissEvent = (event: Event): void => {
  const customEvent = event as CustomEvent<IAppDialogDismissDetail | undefined>;
  const current = dialogState.value;
  if (!current) {
    return;
  }
  const requestedId = customEvent.detail?.id;
  // 无 id 时：dismiss 当前对话框；有 id 时：仅当 id 匹配时才关闭
  if (requestedId && requestedId !== current.id) {
    return;
  }
  handleAction(customEvent.detail?.action ?? 'dismiss');
};

const handleOpenChange = (open: boolean): void => {
  if (!open && dialogState.value) {
    handleAction('dismiss');
  }
};

const handleOpenAutoFocus = (event: Event): void => {
  event.preventDefault();
  void focusDialogPanel();
};

const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (!dialogState.value) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    handleAction('dismiss');
    return;
  }
  if (event.key !== 'Enter' || event.isComposing) {
    return;
  }
  const target = event.target;
  if (
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  handleAction('confirm');
};

onMounted(() => {
  window.addEventListener(APP_DIALOG_EVENT, handleDialogEvent);
  window.addEventListener(APP_DIALOG_DISMISS_EVENT, handleDialogDismissEvent);
  window.addEventListener('keydown', handleWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener(APP_DIALOG_EVENT, handleDialogEvent);
  window.removeEventListener(APP_DIALOG_DISMISS_EVENT, handleDialogDismissEvent);
  window.removeEventListener('keydown', handleWindowKeydown);
  // 卸载时若仍有未结算的对话框，强制结算避免外部 Promise 悬挂
  const pending = dialogState.value;
  if (pending) {
    dialogState.value = null;
    pending.onAction('dismiss');
  }
});
</script>

<style scoped>
.app-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400;
  background: transparent;
  backdrop-filter: none;
  opacity: 1;
  transition: opacity 0.15s ease;
}

.app-dialog-panel {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 1401;
  width: min(360px, calc(100vw - 32px));
  transform: translate(-50%, -50%);
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  background: #252526;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  padding: 20px 20px 14px;
  outline: none;
  -webkit-font-smoothing: antialiased;
  font-family: var(--font-sans, 'PingFang SC', 'Microsoft YaHei', Inter, -apple-system, 'Segoe UI', sans-serif);
  opacity: 1;
  transition:
    transform 0.18s ease,
    opacity 0.15s ease;
}

.app-dialog-panel[data-variant='danger'] {
  border-color: #5a2f35;
}

.app-dialog-copy {
  margin-bottom: 18px;
}

.app-dialog-title {
  margin: 0 0 4px;
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.app-dialog-description {
  margin: 0;
  color: #8a8a8a;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.app-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.app-dialog-button {
  min-width: 0;
  height: 28px;
  border-radius: 5px;
  padding-inline: 12px;
  font-size: 12.5px;
  font-weight: 400;
  box-shadow: none;
  transform: none;
}

.app-dialog-button:active {
  transform: none;
}

.app-dialog-secondary-button {
  border-color: transparent;
  background: transparent;
  color: #8a8a8a;
}

.app-dialog-secondary-button:hover {
  background: transparent;
  color: #cccccc;
}

.app-dialog-primary-button {
  border-color: transparent;
  background: #ffffff;
  color: #1e1e1e;
  font-weight: 500;
}

.app-dialog-primary-button:hover {
  background: #e8e8e8;
  color: #1e1e1e;
}

.app-dialog-overlay[data-state='closed'] {
  opacity: 0;
}

.app-dialog-panel[data-state='closed'] {
  transform: translate(-50%, calc(-50% - 4px));
  opacity: 0;
}
</style>