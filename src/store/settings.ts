import { reactive, watch } from 'vue';
import { extension_settings } from 'st-extensions';
import { getContext } from 'st-context';
import type { AlyceSettings, WorkflowStep, StepType } from '../types/workflow';

export const MODULE_NAME = 'alyce';
export const BUILTIN_STEP_TYPES: StepType[] = ['think', 'outline', 'draft', 'revise', 'final'];
export const DEFAULT_CHAIN_PRESET = [
    '1. 先明确用户目标、限制条件和期望输出。',
    '2. 先判断最合适的回答结构，再进入写作。',
    '3. 标记缺失信息、关键假设和潜在风险。',
    '4. 先写结构化初稿，不急着润色。',
    '5. 输出前再做一轮补漏、压缩和校正。',
].join('\n');

const LEGACY_CHAIN_PRESET_HINT = 'Clarify the exact user goal and constraints.';

export const DEFAULT_THINK_PROMPT = `你是 Alyce 的隐藏“思考”阶段。
请按照预设思维链生成简洁的内部工作笔记。
现在不要直接回答用户。

预设思维链：
{{thinking_chain}}

用户请求：
{{input}}

只返回纯文本工作笔记。`;

export const DEFAULT_OUTLINE_PROMPT = `你是 Alyce 的“分析 / 大纲”阶段。
请结合用户请求和内部笔记，给出粗略结构与覆盖要点。
保持简洁、可执行。

用户请求：
{{input}}

内部笔记：
{{thinking}}

只返回大纲。`;

export const DEFAULT_DRAFT_PROMPT = `请为用户写出第一版工作初稿。
这还不是最终输出。
请基于大纲写作，缺失信息要明确写出，不要掩盖。

用户请求：
{{input}}

内部笔记：
{{thinking}}

大纲：
{{outline}}

只返回初稿。`;

export const DEFAULT_REVISE_PROMPT = `请整改当前工作初稿。
当前是第 {{revision_index}} / {{revision_count}} 轮整改。
优先改善结构、具体度、完整性和表达清晰度，同时保持用户意图不变。

用户请求：
{{input}}

内部笔记：
{{thinking}}

大纲：
{{outline}}

当前初稿：
{{current_draft}}

只返回整改后的工作初稿。`;

export const DEFAULT_FINAL_PROMPT = `请生成最终面向用户的回答。
以当前工作初稿为主。
不要提及内部阶段、隐藏思考或整改回合。

用户请求：
{{input}}

工作初稿：
{{current_draft}}

只返回最终答案。`;

export const DEFAULT_CUSTOM_PROMPT = `请对当前工作初稿执行一个额外的自定义处理环节。
只返回更新后的工作初稿。

用户请求：
{{input}}

当前初稿：
{{current_draft}}

处理目标：
再做一轮清晰度、深度、示例或格式方面的增强。`;

export const DEFAULT_STATUS = '未启用。勾选“启用 Alyce”后，直接在聊天输入框发送消息即可接管本轮生成。';
export const ENABLED_IDLE_STATUS = 'Alyce 已启用。直接在聊天输入框发送消息即可接管本轮生成。';

function clampInteger(value: any, min: number, max: number, fallback: number) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function makeId() {
    const context = getContext();
    return typeof context.uuidv4 === 'function' 
        ? context.uuidv4() as string 
        : `alyce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createBuiltinStep(type: StepType): WorkflowStep {
    switch (type) {
        case 'think': return { id: 'think', type, title: '思考', prompt: DEFAULT_THINK_PROMPT, enabled: true };
        case 'outline': return { id: 'outline', type, title: '分析', prompt: DEFAULT_OUTLINE_PROMPT, enabled: true };
        case 'draft': return { id: 'draft', type, title: '初稿', prompt: DEFAULT_DRAFT_PROMPT, enabled: true };
        case 'revise': return { id: 'revise', type, title: '整改', prompt: DEFAULT_REVISE_PROMPT, enabled: true, rounds: 2 };
        case 'final': return { id: 'final', type, title: '终稿', prompt: DEFAULT_FINAL_PROMPT, enabled: true };
        default: throw new Error(`Unknown builtin step type: ${type}`);
    }
}

function createDefaultWorkflow(): WorkflowStep[] {
    return BUILTIN_STEP_TYPES.map(type => createBuiltinStep(type));
}

function isLegacyBuiltinPrompt(type: string, prompt: string) {
    const checks: Record<string, string> = {
        think: 'You are Alyce in the hidden THINK stage.',
        outline: 'You are Alyce in the ANALYZE stage.',
        draft: 'Write the first working draft for the user.',
        revise: 'Revise the current working draft.',
        final: 'Produce the final user-facing answer.',
    };
    return typeof prompt === 'string' && prompt.includes(checks[type]);
}

function normalizeStep(step: any, legacyRevisionCount = 2): WorkflowStep {
    if (!step || typeof step !== 'object') return createBuiltinStep('draft');

    if (BUILTIN_STEP_TYPES.includes(step.type)) {
        const builtin = createBuiltinStep(step.type as StepType);
        let prompt = typeof step.prompt === 'string' && step.prompt.length > 0 ? step.prompt : builtin.prompt;
        if (isLegacyBuiltinPrompt(step.type, prompt)) prompt = builtin.prompt;

        return {
            ...builtin,
            title: builtin.title,
            prompt,
            enabled: step.enabled !== false,
            ...(step.type === 'revise' ? { rounds: clampInteger(step.rounds, 0, 8, legacyRevisionCount) } : {}),
        };
    }

    let customPrompt = typeof step.prompt === 'string' && step.prompt.length > 0 ? step.prompt : DEFAULT_CUSTOM_PROMPT;
    if (customPrompt.includes('Apply one additional transformation stage to the current working draft.')) {
        customPrompt = DEFAULT_CUSTOM_PROMPT;
    }

    return {
        id: typeof step.id === 'string' && step.id ? step.id : makeId(),
        type: 'custom',
        title: typeof step.title === 'string' && step.title.trim().length > 0 ? step.title.trim() : '自定义环节',
        prompt: customPrompt,
        enabled: step.enabled !== false,
    };
}

function normalizeWorkflow(workflow: any, legacyRevisionCount = 2): WorkflowStep[] {
    if (!Array.isArray(workflow) || workflow.length === 0) return createDefaultWorkflow();
    const sanitized = workflow.filter(step => step?.type !== 'variables');
    const builtinCount = new Set(sanitized.filter(step => BUILTIN_STEP_TYPES.includes(step?.type)).map(step => step.type)).size;
    if (builtinCount !== BUILTIN_STEP_TYPES.length) return createDefaultWorkflow();
    return sanitized.map(step => normalizeStep(step, legacyRevisionCount));
}

export function normalizeSettings(raw: any): AlyceSettings {
    const defaults = {
        enabled: false,
        mode: 'linear' as const,
        chainPreset: DEFAULT_CHAIN_PRESET,
        workflow: createDefaultWorkflow(),
    };

    if (!raw || typeof raw !== 'object') return defaults;

    const legacyRevisionCount = clampInteger(raw.revisionCount, 0, 8, 2);
    const workflow = normalizeWorkflow(raw.workflow, legacyRevisionCount);
    const mode = raw.mode === 'agent' ? 'agent' : 'linear';

    const normalized: AlyceSettings = {
        enabled: Boolean(raw.enabled),
        mode,
        chainPreset: typeof raw.chainPreset === 'string' && raw.chainPreset.trim().length > 0 ? raw.chainPreset : defaults.chainPreset,
        workflow,
    };

    if (normalized.chainPreset.includes(LEGACY_CHAIN_PRESET_HINT)) {
        normalized.chainPreset = defaults.chainPreset;
    }

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

export function getRevisionRounds(step: WorkflowStep) {
    if (step?.type !== 'revise') return 0;
    return clampInteger(step.rounds, 0, 8, 2);
}

// Watchers and global getters are mostly handled in useWorkflow or components.
