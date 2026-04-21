<template>
  <div class="alyce__nodeWrap">
    <button 
      class="alyce__nodeButton"
      :class="{
        'is-selected': isSelected,
        'is-current': isCurrent,
        'is-completed': status === 'completed',
        'is-disabled': step.enabled === false
      }"
      @click="$emit('select', step.id)"
    >
      <span class="alyce__nodeType">{{ typeLabel }}</span>
      <span class="alyce__nodeTitle">{{ step.title }}</span>
      <span class="alyce__nodeMeta">{{ metaLabel }}</span>
    </button>
    <button
      v-if="step.type === 'custom'"
      type="button"
      class="alyce__nodeDelete"
      title="删除自定义环节"
      @click="$emit('delete', step.id)"
    >
      ×
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowStep } from '../types/workflow';

const props = defineProps<{
  step: WorkflowStep;
  isSelected?: boolean;
  isCurrent?: boolean;
  status?: string;
}>();

defineEmits<{
  (e: 'select', id: string): void;
  (e: 'delete', id: string): void;
}>();

const typeLabel = computed(() => {
  switch (props.step.type) {
    case 'think': return '思考';
    case 'outline': return '分析';
    case 'draft': return '初稿';
    case 'revise': return '整改';
    case 'final': return '终稿';
    default: return '扩展';
  }
});

const metaLabel = computed(() => {
  if (props.step.enabled === false) return '已关闭';
  if (props.step.type === 'revise') return `${props.step.rounds ?? 0} 轮`;
  if (props.step.type === 'custom') return '处理当前工作稿';
  return '内置环节';
});
</script>
