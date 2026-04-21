import { saveReply, sendMessageAsUser } from '../../../script.js';
import { renderExtensionTemplateAsync, extension_settings } from '../../extensions.js';
import { Popup, POPUP_TYPE } from '../../popup.js';
import { getContext } from '../../st-context.js';
import { getChatCompletionModel } from '../../openai.js';
import { getTextGenModel } from '../../textgen-settings.js';
import { nai_settings } from '../../nai-settings.js';
import { kai_settings } from '../../kai-settings.js';

const MODULE_NAME = 'alyce';
const BUILTIN_STEP_TYPES = ['think', 'outline', 'draft', 'revise', 'final'];
const DEFAULT_CHAIN_PRESET = [
    '1. 先明确用户目标、限制条件和期望输出。',
    '2. 先判断最合适的回答结构，再进入写作。',
    '3. 标记缺失信息、关键假设和潜在风险。',
    '4. 先写结构化初稿，不急着润色。',
    '5. 输出前再做一轮补漏、压缩和校正。',
].join('\n');

const LEGACY_CHAIN_PRESET_HINT = 'Clarify the exact user goal and constraints.';

const DEFAULT_THINK_PROMPT = `你是 Alyce 的隐藏“思考”阶段。
请按照预设思维链生成简洁的内部工作笔记。
现在不要直接回答用户。

预设思维链：
{{thinking_chain}}

用户请求：
{{input}}

只返回纯文本工作笔记。`;

const DEFAULT_OUTLINE_PROMPT = `你是 Alyce 的“分析 / 大纲”阶段。
请结合用户请求和内部笔记，给出粗略结构与覆盖要点。
保持简洁、可执行。

用户请求：
{{input}}

内部笔记：
{{thinking}}

只返回大纲。`;

const DEFAULT_DRAFT_PROMPT = `请为用户写出第一版工作初稿。
这还不是最终输出。
请基于大纲写作，缺失信息要明确写出，不要掩盖。

用户请求：
{{input}}

内部笔记：
{{thinking}}

大纲：
{{outline}}

只返回初稿。`;

const DEFAULT_REVISE_PROMPT = `请整改当前工作初稿。
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

const DEFAULT_FINAL_PROMPT = `请生成最终面向用户的回答。
以当前工作初稿为主。
不要提及内部阶段、隐藏思考或整改回合。

用户请求：
{{input}}

工作初稿：
{{current_draft}}

只返回最终答案。`;

const DEFAULT_CUSTOM_PROMPT = `请对当前工作初稿执行一个额外的自定义处理环节。
只返回更新后的工作初稿。

用户请求：
{{input}}

当前初稿：
{{current_draft}}

处理目标：
再做一轮清晰度、深度、示例或格式方面的增强。`;

const DEFAULT_STATUS = '未启用。勾选“启用 Alyce”后，直接在聊天输入框发送消息即可接管本轮生成。';
const ENABLED_IDLE_STATUS = 'Alyce 已启用。直接在聊天输入框发送消息即可接管本轮生成。';

let uiState = {
    popup: null,
    root: null,
    selectedStepId: 'think',
    run: createEmptyRunState(),
};

function createBuiltinStep(type) {
    switch (type) {
        case 'think':
            return { id: 'think', type, title: '思考', prompt: DEFAULT_THINK_PROMPT, enabled: true };
        case 'outline':
            return { id: 'outline', type, title: '分析', prompt: DEFAULT_OUTLINE_PROMPT, enabled: true };
        case 'draft':
            return { id: 'draft', type, title: '初稿', prompt: DEFAULT_DRAFT_PROMPT, enabled: true };
        case 'revise':
            return { id: 'revise', type, title: '整改', prompt: DEFAULT_REVISE_PROMPT, enabled: true, rounds: 2 };
        case 'final':
            return { id: 'final', type, title: '终稿', prompt: DEFAULT_FINAL_PROMPT, enabled: true };
        default:
            throw new Error(`Unknown builtin step type: ${type}`);
    }
}

function createDefaultWorkflow() {
    return BUILTIN_STEP_TYPES.map(type => createBuiltinStep(type));
}

function createDefaultSettings() {
    return {
        enabled: false,
        mode: 'linear',
        chainPreset: DEFAULT_CHAIN_PRESET,
        workflow: createDefaultWorkflow(),
    };
}

function createEmptyRunState() {
    return {
        isRunning: false,
        status: '',
        statusKind: 'idle',
        events: [],
        stageOutputs: [],
        finalOutput: '',
        lastInput: '',
        lastScratch: null,
        currentStepId: null,
        stepStatuses: {},
        modeUsed: null,
        toolCallingNote: null,
    };
}

function ensureSettings() {
    extension_settings[MODULE_NAME] = normalizeSettings(extension_settings[MODULE_NAME]);
    return extension_settings[MODULE_NAME];
}

function normalizeSettings(raw) {
    const defaults = createDefaultSettings();

    if (!raw || typeof raw !== 'object') {
        return defaults;
    }

    const legacyRevisionCount = clampInteger(raw.revisionCount, 0, 8, 2);
    const workflow = normalizeWorkflow(raw.workflow, legacyRevisionCount);
    const mode = raw.mode === 'agent' ? 'agent' : 'linear';

    const normalized = {
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

function normalizeWorkflow(workflow, legacyRevisionCount = 2) {
    if (!Array.isArray(workflow) || workflow.length === 0) {
        return createDefaultWorkflow();
    }

    const sanitized = workflow.filter(step => step?.type !== 'variables');
    const builtinCount = new Set(sanitized.filter(step => BUILTIN_STEP_TYPES.includes(step?.type)).map(step => step.type)).size;
    if (builtinCount !== BUILTIN_STEP_TYPES.length) {
        return createDefaultWorkflow();
    }

    return sanitized.map(step => normalizeStep(step, legacyRevisionCount));
}

function normalizeStep(step, legacyRevisionCount = 2) {
    if (!step || typeof step !== 'object') {
        return createBuiltinStep('draft');
    }

    if (BUILTIN_STEP_TYPES.includes(step.type)) {
        const builtin = createBuiltinStep(step.type);
        let prompt = typeof step.prompt === 'string' && step.prompt.length > 0 ? step.prompt : builtin.prompt;

        if (isLegacyBuiltinPrompt(step.type, prompt)) {
            prompt = builtin.prompt;
        }

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

function isLegacyBuiltinPrompt(type, prompt) {
    const checks = {
        think: 'You are Alyce in the hidden THINK stage.',
        outline: 'You are Alyce in the ANALYZE stage.',
        draft: 'Write the first working draft for the user.',
        revise: 'Revise the current working draft.',
        final: 'Produce the final user-facing answer.',
    };

    return typeof prompt === 'string' && prompt.includes(checks[type]);
}

function getSettings() {
    return ensureSettings();
}

function saveSettings() {
    const context = getContext();
    context.saveSettingsDebounced();
}

function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function makeId() {
    const context = getContext();
    return typeof context.uuidv4 === 'function' ? context.uuidv4() : `alyce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#039;');
}

function shorten(text, maxLength = 180) {
    const normalized = String(text ?? '').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return normalized.slice(0, maxLength - 1) + '…';
}

function getToolCallingSnapshot() {
    const context = getContext();
    const quietTools = typeof context.canPerformToolCalls === 'function' ? context.canPerformToolCalls('quiet') : false;
    const liveTools = typeof context.canPerformToolCalls === 'function' ? context.canPerformToolCalls('normal') : false;

    return {
        quietTools,
        liveTools,
        note: quietTools
            ? '当前后端允许在静默运行阶段执行工具调用。'
            : '静默运行会继承当前 API，但这里的静默生成暂时不能直接执行工具调用，所以代理模式目前侧重可视化编排、状态展示和继续控制。',
    };
}

function getConnectionSnapshot() {
    const context = getContext();
    const mainApi = context.mainApi || 'unknown';
    const snapshot = {
        api: mainApi,
        source: mainApi,
        model: 'Inherited',
        preset: 'Inherited',
    };

    if (mainApi === 'openai') {
        snapshot.source = context.chatCompletionSettings?.chat_completion_source || 'openai';
        snapshot.model = getChatCompletionModel(context.chatCompletionSettings) || 'auto';
        snapshot.preset = context.chatCompletionSettings?.preset_settings_openai || 'Default';
        return snapshot;
    }

    if (mainApi === 'textgenerationwebui') {
        snapshot.source = context.textCompletionSettings?.type || 'textgenerationwebui';
        snapshot.model = getTextGenModel(context.textCompletionSettings) || 'unknown';
        snapshot.preset = context.textCompletionSettings?.preset || 'Default';
        return snapshot;
    }

    if (mainApi === 'novel') {
        snapshot.source = 'novel';
        snapshot.model = nai_settings.model_novel || 'unknown';
        snapshot.preset = nai_settings.preset_settings_novel || 'Default';
        return snapshot;
    }

    if (mainApi === 'kobold' || mainApi === 'koboldhorde') {
        snapshot.source = mainApi;
        snapshot.model = kai_settings.api_server || 'server-defined';
        snapshot.preset = kai_settings.preset_settings || 'gui';
        return snapshot;
    }

    return snapshot;
}

function renderWorkspace() {
    if (!uiState.root) {
        return;
    }

    renderConnectionBar();
    renderToolbar();
    renderStatusBanner();
    renderModeViews();
    renderLinearRail();
    renderStepEditor();
    renderAgentStream();
    renderAgentSidebar();
}

function renderConnectionBar() {
    const snapshot = getConnectionSnapshot();
    const toolSnapshot = getToolCallingSnapshot();
    const settings = getSettings();

    uiState.root.find('#alyce_connection_bar').html(`
        <div class="alyce__chip"><span class="alyce__chipLabel">接管</span><strong>${settings.enabled ? '已启用' : '未启用'}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">接口</span><strong>${escapeHtml(snapshot.api)}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">来源</span><strong>${escapeHtml(snapshot.source)}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">模型</span><strong>${escapeHtml(snapshot.model)}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">预设</span><strong>${escapeHtml(snapshot.preset)}</strong></div>
        <div class="alyce__chip"><span class="alyce__chipLabel">工具</span><strong>${toolSnapshot.liveTools ? '实时可用' : '以编排为主'}</strong></div>
    `);
}

function renderToolbar() {
    const settings = getSettings();

    uiState.root.find('.alyce__modeTab').each((_, element) => {
        const button = $(element);
        button.toggleClass('is-active', button.data('mode') === settings.mode);
    });

    uiState.root.find('#alyce_enabled').prop('checked', settings.enabled);
}

function renderStatusBanner() {
    const banner = uiState.root.find('#alyce_status_banner');
    const idleStatus = getSettings().enabled ? ENABLED_IDLE_STATUS : DEFAULT_STATUS;
    banner.removeClass('is-running is-error');
    banner.text(uiState.run.status || idleStatus);

    if (uiState.run.statusKind === 'running') {
        banner.addClass('is-running');
    }

    if (uiState.run.statusKind === 'error') {
        banner.addClass('is-error');
    }
}

function renderModeViews() {
    const settings = getSettings();
    uiState.root.find('#alyce_linear_view').toggleClass('alyce__view--hidden', settings.mode !== 'linear');
    uiState.root.find('#alyce_agent_view').toggleClass('alyce__view--hidden', settings.mode !== 'agent');
}

function getStepStatus(stepId) {
    return uiState.run.stepStatuses[stepId] || 'pending';
}

function getStepTypeLabel(step) {
    switch (step.type) {
        case 'think':
            return '思考';
        case 'outline':
            return '分析';
        case 'draft':
            return '初稿';
        case 'revise':
            return '整改';
        case 'final':
            return '终稿';
        case 'custom':
        default:
            return '扩展';
    }
}

function getStepMeta(step) {
    if (step.enabled === false) {
        return '已关闭';
    }
    if (step.type === 'revise') {
        return `${getRevisionRounds(step)} 轮`;
    }
    if (step.type === 'custom') {
        return '处理当前工作稿';
    }
    return '内置环节';
}

function renderLinearRail() {
    const settings = getSettings();
    const items = [];

    for (let index = 0; index <= settings.workflow.length; index++) {
        if (index < settings.workflow.length) {
            items.push(`
                <button class="alyce__insertButton" data-action="insert-step" data-index="${index}" title="插入自定义环节">
                    +
                </button>
            `);
        }

        if (index === settings.workflow.length) {
            continue;
        }

        const step = settings.workflow[index];
        const status = getStepStatus(step.id);
        const classes = [
            'alyce__nodeButton',
            uiState.selectedStepId === step.id ? 'is-selected' : '',
            uiState.run.currentStepId === step.id ? 'is-current' : '',
            status === 'completed' ? 'is-completed' : '',
            step.enabled === false ? 'is-disabled' : '',
        ].filter(Boolean).join(' ');

        items.push(`
            <div class="alyce__nodeWrap">
                <button class="${classes}" data-action="select-step" data-step-id="${escapeHtml(step.id)}">
                    <span class="alyce__nodeType">${escapeHtml(getStepTypeLabel(step))}</span>
                    <span class="alyce__nodeTitle">${escapeHtml(step.title)}</span>
                    <span class="alyce__nodeMeta">${escapeHtml(getStepMeta(step))}</span>
                </button>
                ${step.type === 'custom' ? `
                    <button
                        type="button"
                        class="alyce__nodeDelete"
                        data-action="delete-step"
                        data-step-id="${escapeHtml(step.id)}"
                        onclick="globalThis.alyceDeleteCustomStep && globalThis.alyceDeleteCustomStep('${escapeHtml(step.id)}'); return false;"
                        title="删除自定义环节"
                    >
                        ×
                    </button>
                ` : ''}
            </div>
        `);
    }

    uiState.root.find('#alyce_linear_rail').html(items.join(''));
}

function getSelectedStep() {
    const settings = getSettings();
    const selected = settings.workflow.find(step => step.id === uiState.selectedStepId);
    return selected || settings.workflow[0];
}

function getStepDescription(step) {
    switch (step.type) {
        case 'think':
            return '按照预设思维链进行一次隐藏思考，产出内部工作笔记。';
        case 'outline':
            return '在起草之前先整理大致结构和覆盖范围。';
        case 'draft':
            return '根据大纲生成第一版工作初稿。';
        case 'revise':
            return '按预设整改提示词进行可重复的整改循环。';
        case 'final':
            return '最终面向用户的输出，并写回聊天。关闭后会以前一版工作稿作为最终回复。';
        case 'custom':
        default:
            return '由你插入的自定义处理环节，输出下一版工作稿。';
    }
}

function renderStepEditor() {
    const step = getSelectedStep();
    if (!step) {
        uiState.root.find('#alyce_linear_editor').html('<p class="alyce__emptyState">当前没有选中的环节。</p>');
        return;
    }

    const isCustom = step.type === 'custom';
    const isThink = step.type === 'think';
    const isRevise = step.type === 'revise';
    const enabledLabel = step.enabled !== false ? '已启用' : '已关闭';

    const html = `
        <div class="alyce__editorOverview">
            <div class="alyce__editorEyebrow">当前环节</div>
            <div class="alyce__editorHeading">
                <div class="alyce__editorTitleGroup">
                    <strong class="alyce__editorTitle">${escapeHtml(step.title)}</strong>
                    <span class="alyce__editorType">${escapeHtml(getStepTypeLabel(step))}</span>
                </div>
                <span class="alyce__editorState ${step.enabled !== false ? 'is-enabled' : 'is-disabled'}">${enabledLabel}</span>
            </div>
            <p>${escapeHtml(getStepDescription(step))}</p>
        </div>
        <div class="alyce__editorMetaGrid">
            <div class="alyce__field alyce__field--toggle">
                <label class="alyce__toggle">
                    <input type="checkbox" data-field="step-enabled" ${step.enabled !== false ? 'checked' : ''}>
                    <span>启用当前环节</span>
                </label>
                <p class="alyce__note">关闭后，这个模块会在本轮 Alyce 编排里跳过。</p>
            </div>
            ${isCustom ? `
                <div class="alyce__field">
                    <label for="alyce_step_title">自定义标题</label>
                    <input id="alyce_step_title" data-macros-autocomplete="hide" data-field="step-title" type="text" value="${escapeHtml(step.title)}">
                </div>
            ` : `
                <div class="alyce__field">
                    <label>标题</label>
                    <div class="alyce__fieldValue">${escapeHtml(step.title)}</div>
                </div>
            `}
            ${isRevise ? `
                <div class="alyce__field">
                    <label for="alyce_step_revision_count">整改轮数</label>
                    <input id="alyce_step_revision_count" data-macros-autocomplete="hide" data-field="revision-count" type="number" min="0" max="8" step="1" value="${escapeHtml(getRevisionRounds(step))}">
                    <p class="alyce__note">仅作用于当前整改模块。设为 0 等于跳过整改。</p>
                </div>
            ` : ''}
        </div>
        ${isThink ? `
            <div class="alyce__field alyce__field--full">
                <label for="alyce_chain_preset">预设思维链</label>
                <textarea id="alyce_chain_preset" data-macros-autocomplete="hide" data-field="chain-preset" rows="8">${escapeHtml(getSettings().chainPreset)}</textarea>
            </div>
        ` : ''}
        <div class="alyce__field alyce__field--full">
            <label for="alyce_step_prompt">提示词模板</label>
            <textarea id="alyce_step_prompt" data-macros-autocomplete="hide" data-field="step-prompt" rows="${isThink ? 14 : 12}">${escapeHtml(step.prompt)}</textarea>
        </div>
        ${isCustom ? '<button class="menu_button alyce__dangerButton" data-action="delete-step">删除自定义环节</button>' : ''}
    `;

    uiState.root.find('#alyce_linear_editor').html(html);
}

function renderAgentStream() {
    const target = uiState.root.find('#alyce_agent_stream');
    if (!uiState.run.events.length) {
        target.html(`
            <div class="alyce__emptyCard">
                <strong>还没有代理事件</strong>
                <p>先在聊天楼层发送一条消息，或在下方输入补充指令。事件会按执行顺序持续追加在这里。</p>
            </div>
        `);
        return;
    }

    const html = uiState.run.events.map(event => `
        <article class="alyce__streamItem">
            <div class="alyce__streamHeader">
                <span class="alyce__badge alyce__badge--${escapeHtml(event.kind)}">${escapeHtml(event.badge)}</span>
                <strong>${escapeHtml(event.title)}</strong>
            </div>
            ${event.body ? `<div class="alyce__streamBody">${escapeHtml(event.body)}</div>` : ''}
            ${event.meta ? `<div class="alyce__streamMeta">${escapeHtml(event.meta)}</div>` : ''}
        </article>
    `).join('');

    target.html(html);
    const element = target.get(0);
    if (element) {
        element.scrollTop = element.scrollHeight;
    }
}

function renderAgentSidebar() {
    const snapshot = getConnectionSnapshot();
    const toolSnapshot = getToolCallingSnapshot();
    const settings = getSettings();
    const completedCount = Object.values(uiState.run.stepStatuses).filter(status => status === 'completed').length;
    const totalCount = settings.workflow.filter(step => step.enabled !== false).length;
    const modeLabel = uiState.run.modeUsed || settings.mode;
    const idleStatus = settings.enabled ? ENABLED_IDLE_STATUS : DEFAULT_STATUS;

    uiState.root.find('#alyce_status_bar').html(`
        <div class="alyce__statusGrid">
            <div class="alyce__statusItem">
                <div class="alyce__statusItemLabel">接管</div>
                <div class="alyce__statusItemValue">${settings.enabled ? '开启' : '关闭'}</div>
            </div>
            <div class="alyce__statusItem">
                <div class="alyce__statusItemLabel">模式</div>
                <div class="alyce__statusItemValue">${escapeHtml(getModeLabel(modeLabel))}</div>
            </div>
            <div class="alyce__statusItem">
                <div class="alyce__statusItemLabel">任务</div>
                <div class="alyce__statusItemValue">${completedCount}/${totalCount}</div>
            </div>
            <div class="alyce__statusItem">
                <div class="alyce__statusItemLabel">接口</div>
                <div class="alyce__statusItemValue">${escapeHtml(snapshot.api)}</div>
            </div>
            <div class="alyce__statusItem">
                <div class="alyce__statusItemLabel">来源</div>
                <div class="alyce__statusItemValue">${escapeHtml(snapshot.source)}</div>
            </div>
            <div class="alyce__statusItem">
                <div class="alyce__statusItemLabel">模型</div>
                <div class="alyce__statusItemValue">${escapeHtml(snapshot.model)}</div>
            </div>
        </div>
        <div class="alyce__statusCurrent">
            <div class="alyce__statusCurrentLabel">当前状态</div>
            <div class="alyce__statusCurrentBody">${escapeHtml(uiState.run.status || idleStatus)}</div>
        </div>
    `);

    renderTodoPanel();
    renderDetailsPanel(toolSnapshot);
}

function renderTodoPanel() {
    const settings = getSettings();
    const items = settings.workflow.map(step => {
        const status = step.enabled === false ? 'skipped' : getStepStatus(step.id);
        const classes = ['alyce__todoItem', `is-${status.replaceAll('_', '-')}`].join(' ');
        const statusLabel = status === 'completed'
            ? '完成'
            : status === 'in_progress'
                ? '进行中'
                : status === 'skipped'
                    ? '跳过'
                    : '待执行';
        const meta = step.type === 'revise'
            ? `${getRevisionRounds(step)} 轮整改`
            : getStepTypeLabel(step);

        return `
            <div class="${classes}">
                <div class="alyce__todoHead">
                    <span class="alyce__todoState">${escapeHtml(statusLabel)}</span>
                    <strong>${escapeHtml(step.title)}</strong>
                </div>
                <div class="alyce__todoMeta">${escapeHtml(meta)}</div>
            </div>
        `;
    }).join('');

    uiState.root.find('#alyce_agent_todos').html(items);
}

function renderDetailsPanel(toolSnapshot) {
    const scratch = uiState.run.lastScratch;
    const idleStatus = getSettings().enabled ? ENABLED_IDLE_STATUS : DEFAULT_STATUS;
    const cards = [
        {
            title: '执行说明',
            body: toolSnapshot.note,
        },
        {
            title: '当前工作稿',
            body: scratch?.currentDraft || '当前还没有工作稿。',
        },
        {
            title: '当前状态',
            body: uiState.run.status || idleStatus,
        },
    ];

    const html = cards.map(card => `
        <div class="alyce__detailCard">
            <div class="alyce__detailCardTitle">${escapeHtml(card.title)}</div>
            <div class="alyce__detailBody">${escapeHtml(shorten(card.body, 500))}</div>
        </div>
    `).join('');

    uiState.root.find('#alyce_agent_details').html(html);
}

function setMode(mode) {
    const settings = getSettings();
    settings.mode = mode === 'agent' ? 'agent' : 'linear';
    saveSettings();
    renderWorkspace();
}

function getModeLabel(mode) {
    return mode === 'agent' ? '代理模式' : '线性模式';
}

function setSelectedRevisionCount(value) {
    const step = getSelectedStep();
    if (!step || step.type !== 'revise') {
        return;
    }
    step.rounds = clampInteger(value, 0, 8, getRevisionRounds(step));
    saveSettings();
    renderWorkspace();
}

function setAlyceEnabled(enabled) {
    const settings = getSettings();
    settings.enabled = Boolean(enabled);
    if (!uiState.run.isRunning && [DEFAULT_STATUS, ENABLED_IDLE_STATUS, ''].includes(uiState.run.status)) {
        uiState.run.status = '';
        uiState.run.statusKind = 'idle';
    }
    saveSettings();
    renderWorkspace();
}

function selectStep(stepId) {
    uiState.selectedStepId = stepId;
    renderLinearRail();
    renderStepEditor();
}

function insertCustomStep(index) {
    const settings = getSettings();
    const finalIndex = settings.workflow.findIndex(step => step.type === 'final');
    const safeIndex = finalIndex >= 0
        ? Math.min(Math.max(0, Number(index) || 0), finalIndex)
        : Math.min(Math.max(0, Number(index) || 0), settings.workflow.length);
    const step = {
        id: makeId(),
        type: 'custom',
        title: '自定义环节',
        prompt: DEFAULT_CUSTOM_PROMPT,
        enabled: true,
    };
    settings.workflow.splice(safeIndex, 0, step);
    uiState.selectedStepId = step.id;
    saveSettings();
    renderWorkspace();
}

function deleteSelectedCustomStep(stepId = null) {
    const settings = getSettings();
    const selected = stepId
        ? settings.workflow.find(step => step.id === stepId)
        : getSelectedStep();
    if (!selected || selected.type !== 'custom') {
        return;
    }
    settings.workflow = settings.workflow.filter(step => step.id !== selected.id);
    extension_settings[MODULE_NAME].workflow = settings.workflow;
    uiState.selectedStepId = settings.workflow[0]?.id || 'think';
    saveSettings();
    renderWorkspace();
}

function updateSelectedStepField(field, value) {
    const step = getSelectedStep();
    if (!step) {
        return;
    }

    if (field === 'step-title' && step.type === 'custom') {
        step.title = String(value || '').trim() || '自定义环节';
    }

    if (field === 'step-prompt') {
        step.prompt = String(value || '');
    }

    if (field === 'step-enabled') {
        step.enabled = Boolean(value);
    }

    if (field === 'revision-count' && step.type === 'revise') {
        step.rounds = clampInteger(value, 0, 8, getRevisionRounds(step));
    }

    saveSettings();
}

function updateChainPreset(value) {
    const settings = getSettings();
    settings.chainPreset = String(value || '');
    saveSettings();
}

function getRevisionRounds(step) {
    if (step?.type !== 'revise') {
        return 0;
    }
    return clampInteger(step.rounds, 0, 8, 2);
}

function buildInterpolationMap(step, scratch, extra = {}) {
    return {
        input: scratch.input,
        thinking_chain: getSettings().chainPreset,
        thinking: scratch.thinking,
        outline: scratch.outline,
        draft: scratch.draft,
        current_draft: scratch.currentDraft,
        revision_count: String(extra.revisionCount ?? (step.type === 'revise' ? getRevisionRounds(step) : 0)),
        revision_index: String(extra.revisionIndex ?? ''),
        step_title: step.title,
    };
}

function interpolateTemplate(template, values) {
    return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(values[key] ?? ''));
}

function pushEvent(kind, title, body = '', meta = '') {
    const badgeMap = {
        user: '用户',
        thinking: '思考',
        tool: '工具',
        assistant: '输出',
        error: '错误',
        system: '系统',
    };

    uiState.run.events.push({
        kind,
        badge: badgeMap[kind] || 'SYSTEM',
        title,
        body,
        meta,
    });
}

function addStageOutput(title, body, meta = '') {
    uiState.run.stageOutputs.push({ title, body, meta });
}

function setStepStatus(stepId, status) {
    uiState.run.stepStatuses[stepId] = status;
}

function syncRunArtifacts(scratch) {
    uiState.run.lastScratch = structuredClone(scratch);
    if (scratch.final) {
        uiState.run.finalOutput = scratch.final;
    }
}

function resetRunState(modeUsed, inputText) {
    uiState.run = createEmptyRunState();
    uiState.run.isRunning = true;
    uiState.run.modeUsed = modeUsed;
    uiState.run.lastInput = inputText;
    uiState.run.status = 'Alyce 已开始处理。';
    uiState.run.statusKind = 'running';
    uiState.run.toolCallingNote = getToolCallingSnapshot().note;

    const settings = getSettings();
    for (const step of settings.workflow) {
        uiState.run.stepStatuses[step.id] = step.enabled === false ? 'skipped' : 'pending';
    }
}

async function tick() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function runQuietStage(step, scratch, options = {}) {
    const context = getContext();
    const prompt = interpolateTemplate(step.prompt, buildInterpolationMap(step, scratch, options));
    const result = await context.generateQuietPrompt({ quietPrompt: prompt });
    return String(result ?? '').trim();
}

function getRunnableWorkflow() {
    const settings = getSettings();
    return settings.workflow.filter(step => step.enabled !== false);
}

function clearChatInput() {
    const textarea = /** @type {HTMLTextAreaElement} */ (document.getElementById('send_textarea'));
    if (textarea) {
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function getCurrentChatInput() {
    return String($('#send_textarea').val() ?? '').trim();
}

function ensureChatContext() {
    const context = getContext();
    const currentChatId = typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : context.chatId;
    const hasTarget = Boolean(context.groupId)
        || Number.isInteger(context.characterId)
        || Boolean(context.chatId)
        || Boolean(currentChatId);
    if (!hasTarget) {
        toastr.warning('请先选中角色或群聊，再运行 Alyce。');
        return false;
    }
    return true;
}

async function finalizeAssistantOutput(output, modeUsed, scratch) {
    const context = getContext();
    await saveReply({ type: 'normal', getMessage: output });

    const lastMessage = context.chat.at(-1);
    if (lastMessage && !lastMessage.is_user) {
        lastMessage.extra = lastMessage.extra || {};
        lastMessage.extra.alyce = {
            mode: modeUsed,
            enabled: getSettings().enabled,
            workflow: getSettings().workflow.map(step => ({
                type: step.type,
                title: step.title,
                rounds: step.type === 'revise' ? getRevisionRounds(step) : undefined,
            })),
            generatedAt: new Date().toISOString(),
        };
    }

    await context.saveChat();

    uiState.run.finalOutput = output;
    uiState.run.lastScratch = scratch;
    uiState.run.status = 'Alyce 已完成，并把最终答案写回聊天。';
    uiState.run.statusKind = 'idle';
    uiState.run.isRunning = false;
}

async function runAlyceTurn(inputText, modeUsed, { clearMainInput = false, messageAlreadySent = false } = {}) {
    if (uiState.run.isRunning) {
        toastr.info('Alyce 正在处理中。');
        return;
    }

    if (!ensureChatContext()) {
        return;
    }

    const trimmedInput = String(inputText || '').trim();
    if (!trimmedInput) {
        toastr.warning('请先输入内容。');
        return;
    }

    const settings = getSettings();
    if (!settings.workflow.some(step => step.enabled !== false)) {
        toastr.warning('请至少启用一个 Alyce 环节。');
        return;
    }
    resetRunState(modeUsed, trimmedInput);
    pushEvent('user', '已捕获用户输入', trimmedInput, '只有最终答案会写回聊天。');
    renderWorkspace();
    await tick();

    const scratch = {
        input: trimmedInput,
        thinking: '',
        outline: '',
        draft: '',
        currentDraft: '',
        final: '',
    };

    try {
        if (!messageAlreadySent) {
            await sendMessageAsUser(trimmedInput, '');
            if (clearMainInput) {
                clearChatInput();
            }
            pushEvent('system', '用户消息已写入', '这条用户消息已经进入当前 SillyTavern 聊天记录。', 'Alyce 的中间步骤仍保持隐藏，最终回复会写回正常 AI 楼层。');
        } else {
            pushEvent('system', '已接管当前楼层生成', 'Alyce 正在后台执行多阶段流程。', '最终回复会作为正常 assistant 消息写回当前聊天楼层。');
        }
        renderWorkspace();
        await tick();

        for (const step of getRunnableWorkflow()) {
            uiState.run.currentStepId = step.id;
            setStepStatus(step.id, 'in_progress');
            uiState.run.status = `正在执行${step.title}...`;
            renderWorkspace();
            await tick();

            if (step.type === 'think') {
                scratch.thinking = await runQuietStage(step, scratch);
                addStageOutput(step.title, scratch.thinking, '内部工作笔记');
                pushEvent('thinking', step.title, shorten(scratch.thinking, 700), '隐藏思考阶段已完成。');
            } else if (step.type === 'outline') {
                scratch.outline = await runQuietStage(step, scratch);
                addStageOutput(step.title, scratch.outline, '粗略大纲');
                pushEvent('thinking', step.title, shorten(scratch.outline, 700), '结构分析已完成。');
            } else if (step.type === 'draft') {
                scratch.draft = await runQuietStage(step, scratch);
                scratch.currentDraft = scratch.draft;
                addStageOutput(step.title, scratch.draft, '第一版初稿');
                pushEvent('assistant', step.title, shorten(scratch.draft, 700), '第一版工作初稿已生成。');
            } else if (step.type === 'revise') {
                const revisionRounds = getRevisionRounds(step);
                if (revisionRounds === 0) {
                    addStageOutput(step.title, '整改轮数为 0，当前环节已跳过。', '已跳过');
                    pushEvent('tool', step.title, '整改轮数当前为 0。', '未执行整改循环。');
                } else {
                    for (let index = 1; index <= revisionRounds; index++) {
                        const revised = await runQuietStage(step, scratch, { revisionIndex: index, revisionCount: revisionRounds });
                        scratch.currentDraft = revised;
                        addStageOutput(`${step.title} ${index}/${revisionRounds}`, revised, '整改回合');
                        pushEvent('tool', `${step.title} ${index}/${revisionRounds}`, shorten(revised, 700), `第 ${index} / ${revisionRounds} 轮整改。`);
                        renderWorkspace();
                        await tick();
                    }
                }
            } else if (step.type === 'final') {
                scratch.final = await runQuietStage(step, scratch);
                addStageOutput(step.title, scratch.final, '终稿封装');
                pushEvent('assistant', step.title, shorten(scratch.final, 900), '最终答案已准备完成。');
            } else {
                const transformed = await runQuietStage(step, scratch);
                scratch.currentDraft = transformed;
                addStageOutput(step.title, transformed, '自定义处理');
                pushEvent('tool', step.title, shorten(transformed, 700), '自定义环节已完成。');
            }

            syncRunArtifacts(scratch);
            setStepStatus(step.id, 'completed');
            renderWorkspace();
            await tick();
        }

        uiState.run.currentStepId = null;
        const finalOutput = scratch.final || scratch.currentDraft || scratch.draft || '';
        if (!String(finalOutput).trim()) {
            throw new Error('Alyce 生成了空的最终结果。');
        }
        await finalizeAssistantOutput(finalOutput, modeUsed, scratch);
        renderWorkspace();
        toastr.success('Alyce 已完成本轮处理。');
    } catch (error) {
        uiState.run.currentStepId = null;
        uiState.run.isRunning = false;
        uiState.run.statusKind = 'error';
        uiState.run.status = error?.message ? `Alyce 失败：${error.message}` : 'Alyce 失败。';
        syncRunArtifacts(scratch);
        pushEvent('error', '运行失败', error?.message || String(error), '如有需要，请到浏览器控制台查看详细信息。');
        renderWorkspace();
        console.error('[Alyce]', error);
        toastr.error(error?.message || 'Alyce 运行失败。');
    }
}

async function runAgentFollowup(promptText) {
    const followup = String(promptText || '').trim();
    if (!followup) {
        toastr.warning('请输入补充指令，或直接点“继续”发送“继续”。');
        return;
    }

    await runAlyceTurn(followup, 'agent');
}

async function continueAgentRun() {
    const prompt = String(uiState.root?.find('#alyce_agent_input').val() ?? '').trim() || '继续';
    uiState.root?.find('#alyce_agent_input').val('');
    await runAlyceTurn(prompt, 'agent');
}

function bindWorkspaceEvents(root) {
    root.on('click', '[data-mode]', function () {
        setMode(String($(this).data('mode')));
    });

    root.on('click', '[data-action="select-step"]', function () {
        selectStep(String($(this).data('step-id')));
    });

    root.on('click', '[data-action="insert-step"]', function () {
        insertCustomStep(clampInteger($(this).data('index'), 0, getSettings().workflow.length, getSettings().workflow.length));
    });

    root.on('click', '[data-action="delete-step"]', function (event) {
        event.preventDefault();
        event.stopPropagation();
        deleteSelectedCustomStep(String($(this).attr('data-step-id') || ''));
    });

    root.on('input', '[data-field="step-title"]', function () {
        updateSelectedStepField('step-title', $(this).val());
        renderLinearRail();
    });

    root.on('input', '[data-field="step-prompt"]', function () {
        updateSelectedStepField('step-prompt', $(this).val());
    });

    root.on('change', '[data-field="step-enabled"]', function () {
        updateSelectedStepField('step-enabled', $(this).is(':checked'));
        renderLinearRail();
        renderStepEditor();
        renderAgentSidebar();
    });

    root.on('input', '[data-field="chain-preset"]', function () {
        updateChainPreset($(this).val());
    });

    root.on('input', '[data-field="revision-count"]', function () {
        setSelectedRevisionCount($(this).val());
    });

    root.find('#alyce_enabled').on('change', function () {
        setAlyceEnabled($(this).is(':checked'));
    });

    root.find('#alyce_agent_send').on('click', async () => {
        const prompt = String(root.find('#alyce_agent_input').val() ?? '').trim();
        await runAgentFollowup(prompt);
        root.find('#alyce_agent_input').val('');
    });

    root.find('#alyce_agent_continue').on('click', async () => {
        await continueAgentRun();
    });
}

async function openWorkspace() {
    if (uiState.popup) {
        toastr.info('Alyce 工作台已经打开。');
        return;
    }

    ensureSettings();

    const template = $(await renderExtensionTemplateAsync(MODULE_NAME, 'window', {}));
    bindWorkspaceEvents(template);
    uiState.root = template;
    uiState.selectedStepId = getSettings().workflow.find(step => step.id === uiState.selectedStepId)?.id || getSettings().workflow[0].id;
    renderWorkspace();

    const popup = new Popup(template, POPUP_TYPE.TEXT, '', {
        wide: true,
        wider: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: '关闭',
        cancelButton: false,
        onClose: () => {
            uiState.popup = null;
            uiState.root = null;
        },
    });

    uiState.popup = popup;
    await popup.show();
    requestAnimationFrame(() => {
        const workspaceElement = uiState.root?.get?.(0);
        const popupContent = workspaceElement?.closest?.('.popup-content');
        popupContent?.scrollTo?.({ top: 0, behavior: 'instant' });
        popupContent && (popupContent.scrollTop = 0);
        workspaceElement?.focus?.({ preventScroll: true });
    });
}

async function alyceGenerateInterceptor(chat, _contextSize, abort, type) {
    const settings = getSettings();
    if (!settings.enabled || type !== 'normal') {
        return;
    }

    const lastMessage = chat[chat.length - 1];
    if (!lastMessage?.is_user) {
        return;
    }

    const messageText = String(lastMessage.mes || '').trim();
    if (!messageText) {
        return;
    }

    abort(true);
    await runAlyceTurn(messageText, settings.mode, { messageAlreadySent: true });
}

globalThis.alyceGenerateInterceptor = alyceGenerateInterceptor;
globalThis.alyceDeleteCustomStep = (stepId) => deleteSelectedCustomStep(stepId);

jQuery(async () => {
    ensureSettings();

    const buttonHtml = `
        <div id="alyce_wand_button" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-route extensionsMenuExtensionButton"></div>
            Alyce 工作台
        </div>
    `;

    $('#extensionsMenu').append(buttonHtml);
    $('#alyce_wand_button').on('click', openWorkspace);
});
