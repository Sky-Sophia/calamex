<script setup lang="ts">
import { computed } from 'vue';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type {
  IAiToolConfirmationOption,
  IAiToolConfirmationRequest,
  TAiToolConfirmationDecision,
} from '@/types/ai';

const props = defineProps<{
  confirmation: IAiToolConfirmationRequest;
  disabled: boolean;
}>();

const emit = defineEmits<{
  resolve: [decision: TAiToolConfirmationDecision];
}>();

const visibleOptions = computed(() =>
  props.confirmation.options.filter((option) => option.id !== 'view-details'),
);

const riskLabel = computed(() => {
  switch (props.confirmation.riskLevel) {
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    default:
      return '风险未知';
  }
});

const riskVariant = computed(() => {
  switch (props.confirmation.riskLevel) {
    case 'high':
      return 'destructive' as const;
    case 'medium':
      return 'warning' as const;
    case 'low':
      return 'secondary' as const;
    default:
      return 'default' as const;
  }
});

const reversibleLabel = computed(() =>
  props.confirmation.reversible ? '可回滚' : '需谨慎执行',
);

const getOptionVariant = (option: IAiToolConfirmationOption): 'default' | 'outline' | 'ghost' => {
  const tone = option.tone ?? 'secondary';

  switch (tone) {
    case 'primary':
      return 'default';
    case 'danger':
      return 'outline';
    default:
      return 'ghost';
  }
};

const getOptionClass = (option: IAiToolConfirmationOption): string =>
  option.tone === 'danger' ? 'ai-tool-confirmation-option is-danger' : 'ai-tool-confirmation-option';

const handleOptionClick = (option: IAiToolConfirmationOption): void => {
  if (option.id === 'view-details') {
    return;
  }

  emit('resolve', option.id);
};
</script>

<template>
  <Card class="ai-tool-confirmation-card" aria-label="工具执行确认">
    <CardHeader class="ai-tool-confirmation-header">
      <div class="ai-tool-confirmation-kicker">
        <Badge :variant="riskVariant" class="ai-tool-confirmation-badge">
          {{ riskLabel }}
        </Badge>
        <Badge variant="secondary" class="ai-tool-confirmation-badge">
          {{ confirmation.toolName }}
        </Badge>
        <Badge variant="secondary" class="ai-tool-confirmation-badge">
          {{ reversibleLabel }}
        </Badge>
      </div>
      <CardTitle class="ai-tool-confirmation-title">
        {{ confirmation.question }}
      </CardTitle>
      <CardDescription class="ai-tool-confirmation-summary">
        {{ confirmation.summary }}
      </CardDescription>
    </CardHeader>
    <CardContent v-if="confirmation.impact" class="ai-tool-confirmation-content">
      <Separator class="ai-tool-confirmation-separator" />
      <p class="ai-tool-confirmation-impact">
        {{ confirmation.impact }}
      </p>
    </CardContent>
    <CardFooter class="ai-tool-confirmation-actions">
      <Button
        v-for="option in visibleOptions"
        :key="option.id"
        :variant="getOptionVariant(option)"
        size="sm"
        :class="getOptionClass(option)"
        :disabled="disabled"
        @click="handleOptionClick(option)"
      >
        {{ option.label }}
      </Button>
    </CardFooter>
  </Card>
</template>

<style scoped>
.ai-tool-confirmation-card {
  gap: 0;
  border-color: color-mix(in srgb, var(--accent-strong) 22%, var(--border-subtle));
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-strong) 7%, transparent),
      color-mix(in srgb, var(--surface-soft) 72%, transparent)
    );
  transition:
    opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-confirmation-header {
  gap: 8px;
  padding-bottom: 12px;
}

.ai-tool-confirmation-kicker {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.ai-tool-confirmation-badge {
  min-width: 0;
}

.ai-tool-confirmation-title {
  font-size: 13px;
  line-height: 18px;
}

.ai-tool-confirmation-summary {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.ai-tool-confirmation-content {
  display: grid;
  gap: 10px;
  padding-top: 0;
}

.ai-tool-confirmation-separator {
  background: color-mix(in srgb, var(--border-subtle) 78%, transparent);
}

.ai-tool-confirmation-impact {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;
}

.ai-tool-confirmation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 0;
}

.ai-tool-confirmation-option {
  min-width: 84px;
}

.ai-tool-confirmation-option.is-danger {
  border-color: color-mix(in srgb, var(--danger) 42%, var(--border-subtle));
  color: var(--danger);
}

@media (prefers-reduced-motion: reduce) {
  .ai-tool-confirmation-card {
    transition: none;
  }
}
</style>
