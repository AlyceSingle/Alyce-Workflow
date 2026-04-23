<template>
  <div class="alyce__editorOverview">
    <div class="alyce__editorEyebrow">当前环节</div>
    <div class="alyce__editorHeading">
      <div class="alyce__editorTitleGroup">
        <strong class="alyce__editorTitle">{{ step.title }}</strong>
        <span class="alyce__editorType">{{ typeLabel }}</span>
      </div>
      <span class="alyce__editorState" :class="step.enabled !== false ? 'is-enabled' : 'is-disabled'">
        {{ step.enabled !== false ? '已启用' : '已关闭' }}
      </span>
    </div>
    <p>{{ description }}</p>
  </div>

  <div class="alyce__editorMetaGrid">
    <div class="alyce__field alyce__field--toggle">
      <label class="alyce__toggle">
        <input 
          type="checkbox" 
          :checked="step.enabled !== false" 
          @change="updateEnabled(($event.target as HTMLInputElement).checked)"
        >
        <span>启用当前环节</span>
      </label>
      <p class="alyce__note">关闭后，这个模块会在本轮 Alyce 编排里跳过。</p>
    </div>

    <div v-if="isCustom" class="alyce__field">
      <label>自定义标题</label>
      <input 
        type="text" 
        data-macros-autocomplete="hide"
        :value="step.title"
        @input="updateTitle(($event.target as HTMLInputElement).value)"
      >
    </div>
    <div v-else class="alyce__field">
      <label>标题</label>
      <div class="alyce__fieldValue">{{ step.title }}</div>
    </div>

    <div v-if="isRevise" class="alyce__field">
      <label>整改轮数</label>
      <input 
        type="number" 
        min="0" 
        max="8" 
        step="1"
        data-macros-autocomplete="hide"
        :value="step.rounds ?? 0"
        @input="updateRounds(Number(($event.target as HTMLInputElement).value))"
      >
      <p class="alyce__note">仅作用于当前整改模块。设为 0 等于跳过整改。</p>
    </div>
  </div>

  <div class="alyce__field alyce__field--full">
    <label>提示词模板</label>
    <textarea 
      data-macros-autocomplete="hide"
      :rows="isThink ? 14 : 12"
      :value="step.prompt"
      @input="updatePrompt(($event.target as HTMLTextAreaElement).value)"
    ></textarea>
  </div>

  <button 
    v-if="isCustom" 
    class="menu_button alyce__dangerButton" 
    @click="$emit('delete', step.id)"
  >
    删除自定义环节
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { saveSettings, settingsState } from '../store/settings';
import type { WorkflowStep } from '../types/workflow';

const props = defineProps<{
  step: WorkflowStep;
}>();

const emit = defineEmits<{
  (e: 'delete', id: string): void;
}>();

const isCustom = computed(() => props.step.type === 'custom');
const isThink = computed(() => props.step.type === 'think');
const isRevise = computed(() => props.step.type === 'revise');

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

const description = computed(() => {
  switch (props.step.type) {
    case 'think': return '进行一次隐藏思考，产出内部工作笔记。';
    case 'outline': return '在起草之前先整理大致结构和覆盖范围。';
    case 'draft': return '根据大纲生成第一版工作初稿。';
    case 'revise': return '按预设整改提示词进行可重复的整改循环。';
    case 'final': return '最终面向用户的输出，并写回聊天。关闭后会以前一版工作稿作为最终回复。';
    default: return '由你插入的自定义处理环节，输出下一版工作稿。';
  }
});

function updateEnabled(enabled: boolean) {
  props.step.enabled = enabled;
  saveSettings();
}

function updateTitle(title: string) {
  props.step.title = title.trim() || '自定义环节';
  saveSettings();
}

function updateRounds(value: number) {
  let v = Math.min(8, Math.max(0, value));
  if (isNaN(v)) v = 0;
  props.step.rounds = v;
  saveSettings();
}

function updatePrompt(prompt: string) {
  props.step.prompt = prompt;
  saveSettings();
}
</script>
