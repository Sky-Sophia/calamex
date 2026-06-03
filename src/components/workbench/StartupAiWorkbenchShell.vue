<script setup lang="ts">
// AI 主界面启动骨架。
// 与真身 AiAssistantPanel 共用 AiPanelFrame 外壳（同一套结构与尺寸），保证骨架与真实界面
// 像素一致、切换零跳动。此处仅对“需要等数据”的区域（建议气泡 / 会话 / 输入）渲染占位；
// 不引入任何 AI 子系统，可在启动首帧即时渲染、不拖慢启动。
// 静态问候语属于外壳（非数据），按 App Shell 原则直接真实显示，而非用占位条假装。
import AiPanelFrame from '@/components/business/ai/shell/AiPanelFrame.vue';
import { Skeleton } from '@/components/ui/skeleton';
</script>

<template>
  <AiPanelFrame class="startup-ai-skeleton" decorative :style="{ '--ai-panel-frame-bg': '#ffffff' }">
    <template #mark>
      <Skeleton class="startup-ai-skeleton__mark-icon" />
      <Skeleton class="startup-ai-skeleton__mark-label" />
    </template>

    <template #actions>
      <Skeleton class="startup-ai-skeleton__action" />
      <Skeleton class="startup-ai-skeleton__action" />
      <Skeleton class="startup-ai-skeleton__action" />
    </template>

    <template #body>
      <div class="startup-ai-skeleton__empty">
        <h2 class="startup-ai-skeleton__greeting">有什么我能帮你的吗？</h2>
        <div class="startup-ai-skeleton__row">
          <Skeleton class="startup-ai-skeleton__chip is-w96" />
          <Skeleton class="startup-ai-skeleton__chip is-w128" />
          <Skeleton class="startup-ai-skeleton__chip is-w74" />
        </div>
        <div class="startup-ai-skeleton__row">
          <Skeleton class="startup-ai-skeleton__chip is-w112" />
          <Skeleton class="startup-ai-skeleton__chip is-w88" />
        </div>
      </div>
    </template>

    <template #composer>
      <div class="startup-ai-skeleton__composer">
        <Skeleton class="startup-ai-skeleton__prompt" />
      </div>
    </template>
  </AiPanelFrame>
</template>

<style scoped>
/* 建议空态：复刻真身 .ai-suggestion-empty 的尺寸，保证真身挂载后切换零跳动 */
.startup-ai-skeleton__mark-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 7px;
}

.startup-ai-skeleton__mark-label {
  width: 96px;
  height: 13px;
  border-radius: 999px;
}

.startup-ai-skeleton__action {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 6px;
}

.startup-ai-skeleton__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 6px;
  padding: clamp(64px, 20vh, 200px) 16px 0;
}

.startup-ai-skeleton__greeting {
  margin: 0 0 18px;
  color: var(--text-primary);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.01em;
  text-align: center;
}

.startup-ai-skeleton__row {
  display: flex;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 10px;
}

.startup-ai-skeleton__chip {
  min-height: 34px;
  border-radius: var(--radius-md);
}

.startup-ai-skeleton__chip.is-w74 {
  width: 74px;
}

.startup-ai-skeleton__chip.is-w88 {
  width: 88px;
}

.startup-ai-skeleton__chip.is-w96 {
  width: 96px;
}

.startup-ai-skeleton__chip.is-w112 {
  width: 112px;
}

.startup-ai-skeleton__chip.is-w128 {
  width: 128px;
}

.startup-ai-skeleton__composer {
  padding: 0 10px 10px;
}

.startup-ai-skeleton__prompt {
  width: 100%;
  height: 56px;
  border-radius: 18px;
}

@media (prefers-reduced-motion: reduce) {
  .startup-ai-skeleton :deep(.animate-pulse) {
    animation: none;
  }
}
</style>
