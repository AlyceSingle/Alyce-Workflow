<template>
  <div class="alyce__editorOverview">
    <div class="alyce__editorEyebrow">当前环节</div>
    <div class="alyce__editorHeading">
      <div class="alyce__editorTitleGroup">
        <strong class="alyce__editorTitle">{{ step.title }}</strong>
      </div>
      <span class="alyce__editorState" :class="step.enabled !== false ? 'is-enabled' : 'is-disabled'">
        {{ step.enabled !== false ? '已启用' : '已关闭' }}
      </span>
    </div>
    <p>{{ step.description || '还没有添加环节标注。' }}</p>
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

    <div class="alyce__field">
      <label>环节标题</label>
      <input
        type="text"
        data-macros-autocomplete="hide"
        :value="step.title"
        @input="updateTitle(($event.target as HTMLInputElement).value)"
      >
    </div>

    <div class="alyce__field">
      <label>环节标注</label>
      <input
        type="text"
        data-macros-autocomplete="hide"
        :value="step.description"
        @input="updateDescription(($event.target as HTMLInputElement).value)"
      >
    </div>

    <div class="alyce__field">
      <label>循环轮次</label>
      <input
        type="number"
        min="1"
        max="8"
        step="1"
        data-macros-autocomplete="hide"
        :value="step.rounds ?? 1"
        @input="updateRounds(Number(($event.target as HTMLInputElement).value))"
      >
      <p class="alyce__note">当前环节连续执行的次数。</p>
    </div>

    <div class="alyce__field">
      <label>输出变量名</label>
      <input
        type="text"
        data-macros-autocomplete="hide"
        placeholder="article"
        :value="step.outputVarName || ''"
        @input="updateOutputVarName(($event.target as HTMLInputElement).value)"
      >
      <p class="alyce__note">留空时使用环节标题作为资产名；可在后续模板中用同名宏引用。</p>
    </div>

    <div class="alyce__field alyce__field--toggle">
      <label class="alyce__toggle">
        <input
          type="checkbox"
          :checked="step.isEditTool === true"
          @change="updateIsEditTool(($event.target as HTMLInputElement).checked)"
        >
        <span>启用增量编辑</span>
      </label>
      <p class="alyce__note">开启后，运行时会自动在模板顶部注入 EDIT 工具说明。</p>
    </div>
  </div>

  <div class="alyce__field alyce__field--full">
    <label>提示词模板</label>
    <textarea
      data-macros-autocomplete="hide"
      rows="12"
      :value="step.prompt"
      @input="updatePrompt(($event.target as HTMLTextAreaElement).value)"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { normalizeOutputVarName, saveSettings } from '../store/settings';
import type { WorkflowStep } from '../types/workflow';

const props = defineProps<{
  step: WorkflowStep;
}>();

defineEmits<{
  (e: 'delete', id: string): void;
}>();

function updateEnabled(enabled: boolean) {
  props.step.enabled = enabled;
  saveSettings();
}

function updateTitle(title: string) {
  props.step.title = title.trim() || '自定义环节';
  saveSettings();
}

function updateDescription(desc: string) {
  props.step.description = desc;
  saveSettings();
}

function updateRounds(value: number) {
  let v = Math.min(8, Math.max(1, value));
  if (isNaN(v)) v = 1;
  props.step.rounds = v;
  saveSettings();
}

function updateOutputVarName(value: string) {
  props.step.outputVarName = normalizeOutputVarName(value);
  saveSettings();
}

function updateIsEditTool(enabled: boolean) {
  props.step.isEditTool = enabled;
  saveSettings();
}

function updatePrompt(prompt: string) {
  props.step.prompt = prompt;
  saveSettings();
}
</script>
