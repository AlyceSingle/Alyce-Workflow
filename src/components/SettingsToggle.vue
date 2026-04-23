<template>
  <div class="alyce__toolbar">
    <label class="alyce__toggle alyce__toggle--strong">
      <input
        type="checkbox"
        :checked="settingsState.enabled"
        @change="updateEnabled(($event.target as HTMLInputElement).checked)"
      >
      <span>启用 Alyce</span>
    </label>
    <div class="alyce__modeTabs">
      <button
        class="menu_button alyce__modeTab"
        :class="{ 'is-active': settingsState.mode === 'linear' }"
        @click="updateMode('linear')"
        title="工作流"
      >
        工作流
      </button>
      <button
        class="menu_button alyce__modeTab"
        :class="{ 'is-active': settingsState.mode === 'agent' }"
        @click="updateMode('agent')"
        title="进度"
      >
        进度
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { settingsState, saveSettings } from '../store/settings';

function updateEnabled(enabled: boolean) {
  settingsState.enabled = enabled;
  saveSettings();
}

function updateMode(mode: 'linear' | 'agent') {
  settingsState.mode = mode;
  saveSettings();
}
</script>
