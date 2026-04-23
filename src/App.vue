<template>
  <div id="alyce_workspace" class="alyce" tabindex="-1">
    <div class="alyce__shell">
      
      <div class="alyce__hero">
        <div class="alyce__heroCopy">
          <div class="alyce__eyebrow">多阶段工作流</div>
          <h2 class="alyce__title">Alyce</h2>
        </div>
      </div>

      <div class="alyce__connectionBar">
        <div class="alyce__chip"><span class="alyce__chipLabel">接管</span><strong>{{ settingsState.enabled ? '已启用' : '未启用' }}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">接口</span><strong>{{ connectionSnapshot.api }}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">来源</span><strong>{{ connectionSnapshot.source }}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">模型</span><strong>{{ connectionSnapshot.model }}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">预设</span><strong>{{ connectionSnapshot.preset }}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">工具</span><strong>{{ toolCallingSnapshot.liveTools ? '实时可用' : '以编排为主' }}</strong></div>
      </div>

      <SettingsToggle />

      <div class="alyce__statusBanner" :class="{ 'is-running': isRunning, 'is-error': isError }">
        {{ currentStatus }}
      </div>

      <div v-show="settingsState.mode === 'linear'" class="alyce__view">
        <section class="alyce__panel alyce__panel--rail">
          <div class="alyce__panelHeader">
            <h3>工作流轨道</h3>
            <p>方块节点表示这一次的隐藏执行链。你可以按加号插入新环节，或者点击节点编辑/删除。</p>
          </div>
          <div class="alyce__rail">
            <template v-for="(step, idx) in settingsState.workflow" :key="step.id">
              <button 
                class="alyce__insertButton" 
                title="插入环节"
                @click="insertCustomStep(idx)"
              >
                +
              </button>
              <WorkflowStep
                :step="step"
                :isSelected="selectedStepId === step.id"
                :isCurrent="runState.currentStepId === step.id"
                :status="runState.stepStatuses[step.id] || 'pending'"
                @select="selectedStepId = $event"
                @delete="deleteCustomStep"
              />
            </template>
            <button 
              class="alyce__insertButton" 
              title="插入环节"
              @click="insertCustomStep(settingsState.workflow.length)"
            >
              +
            </button>
          </div>
        </section>
        
        <div class="alyce__linearGrid">
          <section class="alyce__panel">
            <div class="alyce__panelHeader alyce__panelHeader--left">
              <h3>环节编辑器</h3>
              <p>编辑当前选中环节的提示词与启用状态。整改轮数改为在整改模块内单独设置，最终输出仍只会回到聊天楼层。</p>
            </div>
            <div class="alyce__editor">
              <PromptEditor v-if="selectedStep" :step="selectedStep" @delete="deleteCustomStep" />
              <p v-else class="alyce__emptyState">当前没有选中的环节。</p>
            </div>
            <div class="alyce__finalTemplateControl alyce__finalTemplateControl--editor">
              <label for="alyce_final_output_template">最终输出模板</label>
              <textarea
                id="alyce_final_output_template"
                data-macros-autocomplete="hide"
                rows="3"
                :value="settingsState.finalOutputTemplate"
                @input="updateFinalOutputTemplate(($event.target as HTMLTextAreaElement).value)"
              ></textarea>
              <p>可组合多个资产宏，例如 <code v-pre>{{摘要}}</code> 与 <code v-pre>{{正文}}</code>。</p>
            </div>
          </section>
        </div>
      </div>

      <div v-show="settingsState.mode === 'agent'" class="alyce__view">
        <div class="alyce__agentGrid">
          <section class="alyce__panel alyce__panel--agentMain">
            <div class="alyce__panelHeader alyce__panelHeader--left">
              <h3>进度事件流</h3>
              <p>参考本地 AlyceAgent 的终端信息架构，实时展示事件、状态与继续入口。最终回复会直接写回聊天，而不是停留在工作台。</p>
            </div>
            
            <div class="alyce__agentStream" ref="streamContainer">
              <div v-if="!runState.events.length" class="alyce__emptyCard">
                <strong>还没有进度事件</strong>
              <p>先在聊天楼层发送一条消息，或在下方输入内容。事件会按执行顺序持续追加在这里。</p>
              </div>
              <article v-else v-for="(event, i) in runState.events" :key="i" class="alyce__streamItem">
                <div class="alyce__streamHeader">
                  <span class="alyce__badge" :class="`alyce__badge--${event.kind}`">{{ event.badge }}</span>
                  <strong>{{ event.title }}</strong>
                  <button class="alyce__zoomBtn" @click="zoomEvent(event)" title="放大查看" style="margin-left: auto; cursor: pointer; background: none; border: none; color: inherit; opacity: 0.7;"><i class="fa-solid fa-magnifying-glass"></i></button>
                </div>
                <div v-if="event.body" class="alyce__streamBody">{{ shorten(event.body, 1000) }}</div>
                <div v-if="event.meta" class="alyce__streamMeta">{{ event.meta }}</div>
              </article>
            </div>

            <div class="alyce__composer">
              <label class="alyce__composerLabel" for="alyce_agent_input">发送给 AI</label>
              <textarea
                id="alyce_agent_input"
                data-macros-autocomplete="hide"
                rows="4"
                v-model="agentInput"
              ></textarea>
              <div class="alyce__composerActions">
                <button class="menu_button" @click="handleAgentSend">发送</button>
              </div>
            </div>
          </section>

          <section class="alyce__panel alyce__panel--agentSide">
            <div class="alyce__panelHeader alyce__panelHeader--left">
              <h3>进度侧栏</h3>
              <p>状态栏、任务清单，以及当前最新工作内容。</p>
            </div>
            
            <div class="alyce__statusBar">
              <div class="alyce__statusGrid">
                <div class="alyce__statusItem"><div class="alyce__statusItemLabel">接管</div><div class="alyce__statusItemValue">{{ settingsState.enabled ? '开启' : '关闭' }}</div></div>
                <div class="alyce__statusItem"><div class="alyce__statusItemLabel">模式</div><div class="alyce__statusItemValue">{{ runState.modeUsed === 'agent' || settingsState.mode === 'agent' ? '进度' : '工作流' }}</div></div>
                <div class="alyce__statusItem"><div class="alyce__statusItemLabel">任务</div><div class="alyce__statusItemValue">{{ completedTasks }}/{{ totalTasks }}</div></div>
                <div class="alyce__statusItem"><div class="alyce__statusItemLabel">接口</div><div class="alyce__statusItemValue">{{ connectionSnapshot.api }}</div></div>
                <div class="alyce__statusItem"><div class="alyce__statusItemLabel">来源</div><div class="alyce__statusItemValue">{{ connectionSnapshot.source }}</div></div>
                <div class="alyce__statusItem"><div class="alyce__statusItemLabel">模型</div><div class="alyce__statusItemValue">{{ connectionSnapshot.model }}</div></div>
              </div>
              <div class="alyce__statusCurrent">
                <div class="alyce__statusCurrentLabel">当前状态</div>
                <div class="alyce__statusCurrentBody">{{ currentStatus }}</div>
              </div>
            </div>

            <div class="alyce__todoPanel">
              <div v-for="step in settingsState.workflow" :key="'todo-'+step.id" 
                   class="alyce__todoItem" 
                   :class="`is-${getTodoStatusClass(step)}`">
                <div class="alyce__todoHead">
                  <span class="alyce__todoState">{{ getTodoStatusLabel(step) }}</span>
                  <strong>{{ step.title }}</strong>
                </div>
                <div class="alyce__todoMeta">{{ getTodoMeta(step) }}</div>
              </div>
            </div>

            <div class="alyce__detailsPanel">
              <div class="alyce__detailCard">
                <div class="alyce__detailCardTitle">执行说明</div>
                <div class="alyce__detailBody">{{ shorten(toolCallingSnapshot.note, 500) }}</div>
              </div>
              <div class="alyce__detailCard">
                <div class="alyce__detailCardTitle">当前状态</div>
                <div class="alyce__detailBody">{{ currentStatus }}</div>
              </div>
            </div>
          </section>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { settingsState, saveSettings, DEFAULT_FINAL_OUTPUT_TEMPLATE, DEFAULT_STATUS, ENABLED_IDLE_STATUS, createCustomStep } from './store/settings';
import { runState, runAlyceTurn } from './composables/useWorkflow';
import { getConnectionSnapshot, getToolCallingSnapshot, shorten } from './composables/useSillyTavern';
import WorkflowStep from './components/WorkflowStep.vue';
import PromptEditor from './components/PromptEditor.vue';
import SettingsToggle from './components/SettingsToggle.vue';
import { Popup, POPUP_TYPE } from 'st-popup';

const connectionSnapshot = computed(() => getConnectionSnapshot());
const toolCallingSnapshot = computed(() => getToolCallingSnapshot());

const selectedStepId = ref<string | null>(settingsState.workflow[0]?.id || null);
const selectedStep = computed(() => settingsState.workflow.find(s => s.id === selectedStepId.value));

const isRunning = computed(() => runState.statusKind === 'running');
const isError = computed(() => runState.statusKind === 'error');
const currentStatus = computed(() => runState.status || (settingsState.enabled ? ENABLED_IDLE_STATUS : DEFAULT_STATUS));

const streamContainer = ref<HTMLElement | null>(null);
const agentInput = ref('');

const completedTasks = computed(() => Object.values(runState.stepStatuses).filter(s => s === 'completed').length);
const totalTasks = computed(() => settingsState.workflow.filter(s => s.enabled !== false).length);

watch(() => runState.events.length, () => {
  nextTick(() => {
    if (streamContainer.value) {
      streamContainer.value.scrollTop = streamContainer.value.scrollHeight;
    }
  });
});

function insertCustomStep(index: number) {
  const safeIdx = Math.min(index, settingsState.workflow.length);
  const step = createCustomStep();
  step.description = '';
  settingsState.workflow.splice(safeIdx, 0, step);
  selectedStepId.value = step.id;
  saveSettings();
}

function deleteCustomStep(id: string) {
  const target = settingsState.workflow.find(s => s.id === id);
  if (!target) return;
  settingsState.workflow = settingsState.workflow.filter(s => s.id !== target.id);
  if (settingsState.workflow.length > 0) {
    selectedStepId.value = settingsState.workflow[0].id;
  } else {
    selectedStepId.value = null;
  }
  saveSettings();
}

function getTodoStatusClass(step: any) {
  if (step.enabled === false) return 'skipped';
  const status = runState.stepStatuses[step.id] || 'pending';
  return status.replace('_', '-');
}

function getTodoStatusLabel(step: any) {
  if (step.enabled === false) return '跳过';
  const status = runState.stepStatuses[step.id] || 'pending';
  if (status === 'completed') return '完成';
  if (status === 'in_progress') return '进行中';
  return '待执行';
}

function getTodoMeta(step: any) {
  const assetName = step.outputVarName || step.title;
  if (step.isEditTool === true) {
    return `增量编辑 {{${assetName}}}`;
  }
  if (assetName) return `输出 {{${assetName}}}`;
  if (step.rounds && step.rounds > 1) return `${step.rounds} 轮循环`;
  return step.description || '环节';
}

async function handleAgentSend() {
  const prompt = agentInput.value.trim();
  if (!prompt) {
    toastr.warning('请输入要发送给 AI 的内容。');
    return;
  }
  await runAlyceTurn(prompt, 'agent');
  agentInput.value = '';
}

function updateFinalOutputTemplate(template: string) {
  settingsState.finalOutputTemplate = template.trim().length > 0 ? template : DEFAULT_FINAL_OUTPUT_TEMPLATE;
  saveSettings();
}

function zoomEvent(event: any) {
  const content = `
    <div style="text-align: left; max-width: 100%; white-space: pre-wrap; font-family: Consolas, monospace; line-height: 1.5; padding: 10px;">
      <h3 style="margin-top: 0;">${event.title} <small style="opacity: 0.7;">(${event.badge})</small></h3>
      ${event.body ? `<div style="margin-bottom: 10px;"><strong>内容：</strong><br/>${String(event.body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
      ${event.meta ? `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;"><strong>附加信息：</strong><br/>${String(event.meta).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
    </div>
  `;
  const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
    wide: true,
    large: true,
    okButton: '关闭',
    cancelButton: false,
    allowVerticalScrolling: true
  });
  popup.show();
}

window.alyceDeleteCustomStep = deleteCustomStep;
</script>
