<script setup lang="ts">
import AppDialogHost from '@/components/common/AppDialogHost.vue';
import BrowserContextMenuHost from '@/components/common/BrowserContextMenuHost.vue';
import { runtimeErrorState } from '@/utils/runtime-diagnostics';
</script>

<template>
  <div class="app-root-stage">
    <AppDialogHost />
    <BrowserContextMenuHost />
    <section v-if="runtimeErrorState" class="app-runtime-error" role="alert" aria-live="assertive">
      <div class="app-runtime-error__panel">
        <h1 class="app-runtime-error__title">{{ runtimeErrorState.title }}</h1>
        <p class="app-runtime-error__message">{{ runtimeErrorState.message }}</p>
        <pre class="app-runtime-error__detail">{{ runtimeErrorState.detail }}</pre>
      </div>
    </section>
    <router-view v-else />
  </div>
</template>

<style>
.app-runtime-error {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-0);
}

.app-runtime-error__panel {
  width: min(780px, 100%);
  border: 1px solid rgba(255, 107, 122, 0.28);
  border-radius: 12px;
  background: var(--bg-1);
  padding: 20px 24px;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.36);
}

.app-runtime-error__title {
  margin: 0 0 12px;
  color: #ff9aa5;
  font-size: 18px;
}

.app-runtime-error__message {
  margin: 0 0 12px;
  color: #e5e7eb;
  font-size: 14px;
}

.app-runtime-error__detail {
  margin: 0;
  color: #cbd5e1;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.7;
}
</style>
