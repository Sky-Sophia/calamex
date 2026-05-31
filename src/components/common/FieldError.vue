<script setup lang="ts">
const props = defineProps<{
  message: string;
}>();
</script>

<template>
  <p
    class="mt-1.5 flex min-w-0 items-start gap-1.5 text-[12px] leading-5 text-[var(--danger)]"
    role="alert"
  >
    <span class="icon-[lucide--circle-alert] mt-0.5 size-3.5 shrink-0"  />
    <span class="min-w-0 break-words">{{ props.message }}</span>
  </p>
</template>
