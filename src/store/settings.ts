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

export const DEFAULT_FINAL_OUTPUT_TEMPLATE = `{{thinking}}
{{content}}`;

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
    return [
        {
            id: '5a498c4d-9925-495b-be96-c019f222f2fc',
            title: '思考🤔',
            description: 'AI构思如何书写文章',
            prompt: `你需要根据上文预设内容，构思如何写好这次文章

1.读取预设内容，确保充分理解预设指导

2.根据预设思维链，逐步思考，并给出答案

3.构思内容大纲，并输出大纲内容

**注意：你只需要输出思维链内容，不需要输出正文内容，思维链至少2000字**`,
            enabled: true,
            rounds: 1,
            outputVarName: 'thinking',
            isEditTool: false,
        },
        {
            id: '4076f74c-7cf7-492c-a361-0122275abfdf',
            title: '正文',
            description: '输出正文的初稿',
            prompt: `以下为已经思考过的内容
思维链如下：
{{thinking}}

你需要根据已经思考过的思维链，遵循预设和思维链的指导，输出正文

**注意：你不要再输出思维链，只需要输出正文内容**`,
            enabled: true,
            rounds: 1,
            outputVarName: 'content',
            isEditTool: false,
        },
        {
            id: 'f62ae375-4ea5-446d-ace3-c445de423dd9',
            title: '编辑',
            description: 'AI再次回顾正文，对文章进行整改',
            prompt: `以下为已经写出的完整文章

文章如下:
content:{{content}}

你阅读指导，查看content是否符合指导要求
并通过EDIT工具，编辑content，例如[EDIT: content]，可在本次输出中多次使用修改正文

**注意，你只需按格式调用编辑工具，无需输出其他内容**
`,
            enabled: true,
            rounds: 1,
            outputVarName: '',
            isEditTool: true,
        },
    ];
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
