<template>
  <div class="alyce__nodeWrap">
    <button 
      class="alyce__nodeButton"
      :class="{
        'is-selected': isSelected,
        'is-current': isCurrent,
        'is-completed': status === 'completed',
        'is-error': status === 'error',
        'is-disabled': step.enabled === false
      }"
      @click="$emit('select', step.id)"
    >
      <span class="alyce__nodeTitle">{{ step.title }}</span>
      <span class="alyce__nodeMeta">{{ metaLabel }}</span>
    </button>
    <button
      type="button"
      class="alyce__nodeDelete"
      title="删除此环节"
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

const metaLabel = computed(() => {
  if (props.step.enabled === false) return '已关闭';
  const assetName = props.step.outputVarName || props.step.title;
  if (props.step.isEditTool === true) {
    return `编辑 {{${assetName}}}`;
  }
  if (assetName) return `输出 {{${assetName}}}`;
  if (props.step.rounds && props.step.rounds > 1) return `${props.step.rounds} 轮`;
  return props.step.title && props.step.description ? '扩展环节' : '环节';
});
</script>
