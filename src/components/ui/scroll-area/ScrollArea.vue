<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { ScrollAreaRootProps } from "reka-ui"
import {
    ScrollAreaCorner,
    ScrollAreaRoot,
    ScrollAreaScrollbar,
    ScrollAreaThumb,
    ScrollAreaViewport,
    useForwardProps,
} from "reka-ui"
import type { HTMLAttributes } from "vue"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<ScrollAreaRootProps & {
    class?: HTMLAttributes["class"]
    viewportClass?: HTMLAttributes["class"]
  }>(),
  {
    class: undefined,
    viewportClass: undefined,
    type: "auto",
  },
)

const delegatedProps = reactiveOmit(props, "class", "viewportClass")
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <ScrollAreaRoot
    data-slot="scroll-area"
    v-bind="{ ...$attrs, ...forwardedProps }"
    :class="cn('relative overflow-hidden', props.class)"
  >
    <ScrollAreaViewport
      data-slot="scroll-area-viewport"
      :class="cn('h-full w-full rounded-[inherit]', props.viewportClass)"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation="vertical"
      class="flex w-2.5 touch-none select-none p-px"
    >
      <ScrollAreaThumb data-slot="scroll-area-thumb" class="relative flex-1 rounded-full bg-slate-300/70" />
    </ScrollAreaScrollbar>
    <ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation="horizontal"
      class="flex h-2.5 touch-none select-none p-px"
    >
      <ScrollAreaThumb data-slot="scroll-area-thumb" class="relative flex-1 rounded-full bg-slate-300/70" />
    </ScrollAreaScrollbar>
    <ScrollAreaCorner data-slot="scroll-area-corner" class="bg-transparent" />
  </ScrollAreaRoot>
</template>
