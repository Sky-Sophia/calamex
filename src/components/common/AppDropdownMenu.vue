<template>
  <DropdownMenuRoot v-model:open="isOpen">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" :open="isOpen" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent class="dropdown-menu-panel z-[1250] overflow-hidden outline-none" :align="contentAlign"
        :side-offset="8" :collision-padding="8" :style="{ minWidth: `${props.minWidth}px` }">
        <template v-for="item in props.items" :key="item.key">
          <DropdownMenuSeparator v-if="item.separatorBefore" class="mx-2 border-t border-white/8" />
          <DropdownMenuItem class="dropdown-menu-item w-full text-left outline-none" :class="{
            'is-danger': item.tone === 'danger',
            'is-disabled': item.disabled,
            'is-selected': item.selected,
          }" :disabled="item.disabled" @select="handleSelect(item.key)">
            <span class="dropdown-menu-item-main">
              <span class="truncate text-[13px] font-medium">{{ item.label }}</span>
              <span v-if="item.description" class="mt-1 text-[11px] leading-5 text-(--text-quaternary)">
                {{ item.description }}
              </span>
            </span>
            <span v-if="item.selected" class="dropdown-menu-item-check" aria-hidden="true">
              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="m3.5 8.2 2.7 2.7 6.3-6.4" />
              </svg>
            </span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { computed, ref } from 'vue';

interface IDropdownMenuItem {
  key: string;
  label: string;
  description?: string;
  disabled?: boolean;
  selected?: boolean;
  separatorBefore?: boolean;
  tone?: 'default' | 'danger';
}

const props = withDefaults(
  defineProps<{
    items: IDropdownMenuItem[];
    align?: 'left' | 'right';
    minWidth?: number;
  }>(),
  {
    align: 'left',
    minWidth: 160,
  },
);

const emit = defineEmits<{
  select: [key: string];
}>();

const isOpen = ref(false);
const contentAlign = computed(() => (props.align === 'right' ? 'end' : 'start'));

const handleSelect = (key: string): void => {
  emit('select', key);
};
</script>
