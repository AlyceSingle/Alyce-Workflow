import { reactive } from 'vue';
import { extension_settings } from 'st-extensions';
import { getContext } from 'st-context';
import type { AlyceSettings, WorkflowStep } from '../types/workflow';

export const MODULE_NAME = 'alyce';

export const DEFAULT_CUSTOM_PROMPT = `请对当前工作初稿执行一个额外的自定义处理环节。
只返回更新后的工作初稿。

用户请求：
{{input}}

上一步输出：
{{previous_output}}`;

export const DEFAULT_FINAL_OUTPUT_TEMPLATE = '{{previous_output}}';

export const DEFAULT_STATUS = '未启用。勾选“启用 Alyce”后，直接在聊天输入框发送消息即可接管本轮生成。';
export const ENABLED_IDLE_STATUS = 'Alyce 已启用。直接在聊天输入框发送消息即可接管本轮生成。';

export function clampInteger(value: any, min: number, max: number, fallback: number) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

export function makeId() {
    const context = getContext();
    return typeof context.uuidv4 === 'function' 
        ? context.uuidv4() as string 
        : `alyce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeOutputVarName(value: any) {
    const name = typeof value === 'string'
        ? value.replace(/[\r\n{}\[\]]/g, '').replace(/\s+/g, ' ').trim()
        : '';
    return name;
}

export function createCustomStep(): WorkflowStep {
    return {
        id: makeId(),
        title: '自定义环节',
        description: '请输入环节标注',
        prompt: DEFAULT_CUSTOM_PROMPT,
        enabled: true,
        rounds: 1,
        outputVarName: '',
        isEditTool: false,
    };
}

function createDefaultWorkflow(): WorkflowStep[] {
    return [createCustomStep()];
}

function normalizeStep(step: any): WorkflowStep {
    if (!step || typeof step !== 'object') return createCustomStep();

    let title = typeof step.title === 'string' && step.title.trim().length > 0 ? step.title.trim() : '自定义环节';
    let prompt = typeof step.prompt === 'string' && step.prompt.trim().length > 0 ? step.prompt : DEFAULT_CUSTOM_PROMPT;
    let enabled = step.enabled !== false;
    let rounds = step.rounds !== undefined ? clampInteger(step.rounds, 1, 8, 1) : 1;
    let description = typeof step.description === 'string' ? step.description : '';

    return {
        id: typeof step.id === 'string' && step.id ? step.id : makeId(),
        title,
        description,
        prompt,
        enabled,
        rounds,
        outputVarName: normalizeOutputVarName(step.outputVarName),
        isEditTool: step.isEditTool === true,
    };
}

function normalizeWorkflow(workflow: any): WorkflowStep[] {
    if (!Array.isArray(workflow) || workflow.length === 0) return createDefaultWorkflow();
    const sanitized = workflow.filter(step => step?.type !== 'variables'); // for backward compat logic if needed
    if (sanitized.length === 0) return createDefaultWorkflow();
    return sanitized.map(step => normalizeStep(step));
}

function normalizeFinalOutputTemplate(value: any) {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : DEFAULT_FINAL_OUTPUT_TEMPLATE;
}

export function normalizeSettings(raw: any): AlyceSettings {
    const defaults = {
        enabled: false,
        mode: 'linear' as const,
        finalOutputTemplate: DEFAULT_FINAL_OUTPUT_TEMPLATE,
        workflow: createDefaultWorkflow(),
    };

    if (!raw || typeof raw !== 'object') return defaults;

    const workflow = normalizeWorkflow(raw.workflow);
    const mode = raw.mode === 'agent' ? 'agent' : 'linear';

    const normalized: AlyceSettings = {
        enabled: Boolean(raw.enabled),
        mode,
        finalOutputTemplate: normalizeFinalOutputTemplate(raw.finalOutputTemplate),
        workflow,
    };

    return normalized;
}

export const settingsState = reactive<AlyceSettings>(normalizeSettings({}));

export function ensureSettings() {
    const raw = extension_settings[MODULE_NAME];
    const normalized = normalizeSettings(raw);
    Object.assign(settingsState, normalized);
    extension_settings[MODULE_NAME] = settingsState;
    return settingsState;
}

export function saveSettings() {
    extension_settings[MODULE_NAME] = { ...settingsState };
    const context = getContext();
    context.saveSettingsDebounced();
}

// Watchers and global getters are mostly handled in useWorkflow or components.
