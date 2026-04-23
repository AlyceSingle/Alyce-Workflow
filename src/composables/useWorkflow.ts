import { reactive } from 'vue';
import { getContext } from 'st-context';
import { sendMessageAsUser, saveReply } from 'st-script';
import { normalizeOutputVarName, settingsState } from '../store/settings';
import type { RunState, ScratchData, WorkflowStep } from '../types/workflow';

interface AssetEditInstruction {
    varName: string;
    oldString: string;
    newString: string;
    replaceAll: boolean;
}
interface AssetEditResult {
    outputs: Record<string, string>;
    lastOutput: string;
    editedVarNames: string[];
    skippedEdits: string[];
    appliedCount: number;
    matchCount: number;
}

type AssetNameMap = Record<string, string>;
type WorkflowMode = 'linear' | 'agent';

interface WorkflowExecutionOptions {
    startStepId?: string | null;
    startRoundIndex?: number;
}

const QUIET_STAGE_TIMEOUT_MS = 10 * 60 * 1000;

const EDIT_TOOL_PROMPT_PREFIX = `你正在使用 Alyce 的内存资产增量编辑工具。
本环节不要重写全文，只返回一个或多个 EDIT 块。

格式：
[EDIT: asset_name]
OLD: 从目标资产中逐字复制需要替换的旧内容
NEW: 替换后的新内容
[/EDIT]

规则：
- asset_name 必须是当前已有资产名。
- OLD 必须能在目标资产中精确命中。
- 默认只替换一处；如果要替换全部相同内容，使用 [EDIT: asset_name replace_all=true]。
- 不要输出解释、总结、Markdown 代码围栏或修改后的全文。`;

export const runState = reactive<RunState>({
    isRunning: false,
    status: '',
    statusKind: 'idle',
    events: [],
    finalOutput: '',
    lastInput: '',
    lastScratch: null,
    currentStepId: null,
    stepStatuses: {},
    modeUsed: null,
    failedStepId: null,
    failedRoundIndex: null,
    canResume: false,
});

export function pushEvent(kind: 'user' | 'thinking' | 'tool' | 'assistant' | 'error' | 'system', title: string, body = '', meta = '') {
    const badgeMap: Record<string, string> = {
        user: '用户',
        thinking: '思考',
        tool: '工具',
        assistant: '输出',
        error: '错误',
        system: '系统',
    };

    runState.events.push({
        kind,
        badge: badgeMap[kind] || 'SYSTEM',
        title,
        body,
        meta,
    });
}

export function setStepStatus(stepId: string, status: string) {
    runState.stepStatuses[stepId] = status;
}

function cloneScratchData(scratch: ScratchData | null): ScratchData {
    const outputs: Record<string, string> = {};
    const sourceOutputs = scratch?.outputs && typeof scratch.outputs === 'object' ? scratch.outputs : {};

    for (const [key, value] of Object.entries(sourceOutputs)) {
        outputs[String(key)] = String(value ?? '');
    }

    return {
        input: String(scratch?.input ?? ''),
        outputs,
        lastOutput: String(scratch?.lastOutput ?? ''),
    };
}

export function syncRunArtifacts(scratch: ScratchData) {
    runState.lastScratch = cloneScratchData(scratch);
    runState.finalOutput = resolveFinalOutput(scratch) || scratch.lastOutput;
}

export function resetRunState(modeUsed: 'linear' | 'agent', inputText: string) {
    runState.isRunning = true;
    runState.statusKind = 'running';
    runState.status = 'Alyce 已开始处理。';
    runState.events = [];
    runState.finalOutput = '';
    runState.lastInput = inputText;
    runState.lastScratch = null;
    runState.currentStepId = null;
    runState.stepStatuses = {};
    runState.modeUsed = modeUsed;
    runState.failedStepId = null;
    runState.failedRoundIndex = null;
    runState.canResume = false;

    for (const step of settingsState.workflow) {
        runState.stepStatuses[step.id] = step.enabled === false ? 'skipped' : 'pending';
    }
}

function clearResumePoint() {
    runState.failedStepId = null;
    runState.failedRoundIndex = null;
    runState.canResume = false;
}
export function buildInterpolationMap(step: WorkflowStep, scratch: ScratchData, extra: any = {}) {
    return {
        input: scratch.input,
        previous_output: scratch.lastOutput,
        last_output: scratch.lastOutput,
        revision_count: String(extra.revisionCount ?? 0),
        revision_index: String(extra.revisionIndex ?? ''),
        step_title: step.title,
        ...scratch.outputs
    };
}

export function interpolateTemplate(template: string, values: Record<string, string>) {
    return String(template ?? '').replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (_, key) => String(values[String(key).trim()] ?? ''));
}

function getExplicitStepOutputVarName(step: WorkflowStep) {
    return normalizeOutputVarName(step.outputVarName);
}

function getBaseStepOutputVarName(step: WorkflowStep) {
    const customName = getExplicitStepOutputVarName(step);
    if (customName) {
        return customName;
    }
    return normalizeOutputVarName(step.title) || step.id;
}

export function getStepOutputVarName(step: WorkflowStep, assetNameMap?: AssetNameMap) {
    return assetNameMap?.[step.id] || getBaseStepOutputVarName(step);
}

function buildAssetNameMap(workflow: WorkflowStep[]) {
    const seen = new Map<string, number>();
    const assetNameMap: AssetNameMap = {};

    for (const step of workflow) {
        const explicitName = getExplicitStepOutputVarName(step);
        if (explicitName) {
            assetNameMap[step.id] = explicitName;
            continue;
        }

        const baseName = getBaseStepOutputVarName(step);
        const count = seen.get(baseName) || 0;
        seen.set(baseName, count + 1);
        assetNameMap[step.id] = count === 0 ? baseName : `${baseName}_${count + 1}`;
    }

    return assetNameMap;
}

function countMatches(content: string, needle: string) {
    if (!needle) {
        return 0;
    }
    return content.split(needle).length - 1;
}

function unwrapEditSection(text: string) {
    let normalized = text;
    if (normalized.startsWith('\r\n')) {
        normalized = normalized.slice(2);
    } else if (normalized.startsWith('\n')) {
        normalized = normalized.slice(1);
    }

    if (normalized.endsWith('\r\n')) {
        normalized = normalized.slice(0, -2);
    } else if (normalized.endsWith('\n')) {
        normalized = normalized.slice(0, -1);
    }

    return normalized;
}

function parseOldNewSections(varName: string, body: string) {
    const oldLabel = /(?:^|\r?\n)OLD:[ \t]*/.exec(body);
    if (!oldLabel) {
        throw new Error(`[EDIT: ${varName}] 缺少 OLD: 区块。`);
    }

    const oldStart = oldLabel.index + oldLabel[0].length;
    const afterOldLabel = body.slice(oldStart);
    const newLabel = /\r?\nNEW:[ \t]*/.exec(afterOldLabel);
    if (!newLabel) {
        throw new Error(`[EDIT: ${varName}] 缺少 NEW: 区块。`);
    }

    return {
        oldString: unwrapEditSection(afterOldLabel.slice(0, newLabel.index)),
        newString: unwrapEditSection(afterOldLabel.slice(newLabel.index + newLabel[0].length)),
    };
}

function parseAssetEditInstructions(response: string): AssetEditInstruction[] {
    const instructions: AssetEditInstruction[] = [];
    const editBlockPattern = /\[EDIT:\s*([^\]\r\n]+?)\]([\s\S]*?)\[\/EDIT\]/g;
    let match: RegExpExecArray | null;

    while ((match = editBlockPattern.exec(response)) !== null) {
        const [, header, body] = match;
        const replaceAll = /\breplace_all\s*=\s*true\b/i.test(header)
            || /\breplaceAll\s*=\s*true\b/i.test(header);
        const varName = normalizeOutputVarName(header
            .replace(/\breplace_all\s*=\s*true\b/ig, '')
            .replace(/\breplaceAll\s*=\s*true\b/ig, ''));
        if (!varName) {
            throw new Error('EDIT 指令缺少有效资产名。');
        }
        const { oldString, newString } = parseOldNewSections(varName, body);
        instructions.push({ varName, oldString, newString, replaceAll });
    }

    return instructions;
}

export function applyAssetEdit(response: string, scratch: ScratchData, fallbackVarName = ''): AssetEditResult {
    const instructions = parseAssetEditInstructions(response);
    if (instructions.length === 0) {
        throw new Error('增量编辑模式未找到 [EDIT: 变量名] OLD/NEW [/EDIT] 指令。');
    }

    const outputs = { ...scratch.outputs };
    const editedVarNames: string[] = [];
    const skippedEdits: string[] = [];
    let appliedCount = 0;
    let totalMatches = 0;

    for (const instruction of instructions) {
        const currentValue = outputs[instruction.varName];
        if (typeof currentValue !== 'string') {
            throw new Error(`[EDIT: ${instruction.varName}] 找不到可编辑资产。请先在前置环节输出 {{${instruction.varName}}}。`);
        }
        if (instruction.oldString === instruction.newString) {
            throw new Error(`[EDIT: ${instruction.varName}] OLD 与 NEW 完全相同，没有可应用的修改。`);
        }

        const matchCount = countMatches(currentValue, instruction.oldString);
        if (matchCount === 0) {
            skippedEdits.push(`{{${instruction.varName}}}: OLD 内容未找到`);
            continue;
        }
        if (matchCount > 1 && !instruction.replaceAll) {
            throw new Error(`[EDIT: ${instruction.varName}] 找到 ${matchCount} 处 OLD 内容。请提供更精确上下文，或在头部使用 replace_all=true。`);
        }

        outputs[instruction.varName] = instruction.replaceAll
            ? currentValue.split(instruction.oldString).join(instruction.newString)
            : currentValue.replace(instruction.oldString, instruction.newString);
        editedVarNames.push(instruction.varName);
        appliedCount += instruction.replaceAll ? matchCount : 1;
        totalMatches += matchCount;
    }

    const preferredVarName = fallbackVarName && editedVarNames.includes(fallbackVarName)
        ? fallbackVarName
        : editedVarNames.at(-1) || fallbackVarName;

    return {
        outputs,
        lastOutput: preferredVarName ? outputs[preferredVarName] ?? scratch.lastOutput : scratch.lastOutput,
        editedVarNames: [...new Set(editedVarNames)],
        skippedEdits,
        appliedCount,
        matchCount: totalMatches,
    };
}

function saveStepOutput(step: WorkflowStep, scratch: ScratchData, output: string, assetNameMap: AssetNameMap) {
    const varName = getStepOutputVarName(step, assetNameMap);
    scratch.outputs[varName] = output;
    scratch.lastOutput = output;
    return varName;
}

function getEditToolPromptPrefix(_step: WorkflowStep, scratch: ScratchData) {
    const assetNames = Object.keys(scratch.outputs);
    const availableAssets = assetNames.length > 0
        ? assetNames.map(name => `- ${name}`).join('\n')
        : '当前还没有资产';
    return `${EDIT_TOOL_PROMPT_PREFIX}

当前可编辑资产：
${availableAssets}`;
}

function buildStepPromptTemplate(step: WorkflowStep, scratch: ScratchData) {
    if (step.isEditTool !== true) {
        return step.prompt;
    }
    return `${getEditToolPromptPrefix(step, scratch)}

${step.prompt}`;
}

function buildFinalInterpolationMap(scratch: ScratchData) {
    return {
        input: scratch.input,
        previous_output: scratch.lastOutput,
        last_output: scratch.lastOutput,
        ...scratch.outputs,
    };
}

export function resolveFinalOutput(scratch: ScratchData) {
    const template = settingsState.finalOutputTemplate?.trim()
        ? settingsState.finalOutputTemplate
        : '{{previous_output}}';
    return interpolateTemplate(template, buildFinalInterpolationMap(scratch)).trim();
}

async function tick() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function withQuietStageTimeout<T>(promise: Promise<T>, step: WorkflowStep): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`「${step.title}」静默生成超过 10 分钟未返回，已停止等待。`));
        }, QUIET_STAGE_TIMEOUT_MS);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    });
}

export async function runQuietStage(step: WorkflowStep, scratch: ScratchData, options = {}) {
    const context = getContext();
    const promptTemplate = buildStepPromptTemplate(step, scratch);
    const prompt = interpolateTemplate(promptTemplate, buildInterpolationMap(step, scratch, options));
    const generation = step.omitWorldInfoAndPreset === true
        ? context.generateRaw({
            prompt,
            quietToLoud: true,
            trimNames: false,
        })
        : context.generateQuietPrompt({
            quietPrompt: prompt,
            quietToLoud: true,
            skipWIAN: true, // 避免一些无关注入
        });
    const result = await withQuietStageTimeout(generation, step);
    return String(result ?? '').trim();
}

export function getRunnableWorkflow() {
    return settingsState.workflow.filter(step => step.enabled !== false);
}

export function ensureChatContext() {
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

export async function finalizeAssistantOutput(output: string, modeUsed: WorkflowMode, scratch: ScratchData) {
    const context = getContext();
    await saveReply({ type: 'normal', getMessage: output });

    const lastMessage = context.chat.at(-1);
    if (lastMessage && !lastMessage.is_user) {
        lastMessage.extra = lastMessage.extra || {};
        lastMessage.extra.alyce = {
            mode: modeUsed,
            enabled: settingsState.enabled,
            workflow: settingsState.workflow.map(step => ({
                title: step.title,
                rounds: step.rounds,
                outputVarName: step.outputVarName || undefined,
                isEditTool: step.isEditTool === true,
                omitWorldInfoAndPreset: step.omitWorldInfoAndPreset === true,
            })),
            finalOutputTemplate: settingsState.finalOutputTemplate,
            generatedAt: new Date().toISOString(),
        };
    }

    await context.saveChat();

    runState.finalOutput = output;
    runState.lastScratch = cloneScratchData(scratch);
    runState.status = 'Alyce 已完成，并把最终答案写回聊天。';
    runState.statusKind = 'idle';
    runState.isRunning = false;
    runState.currentStepId = null;
    clearResumePoint();
}

async function finalizeScratch(scratch: ScratchData, modeUsed: WorkflowMode) {
    runState.currentStepId = null;
    clearResumePoint();

    const finalOutput = resolveFinalOutput(scratch);
    if (!String(finalOutput).trim()) {
        throw new Error('Alyce 生成了空的最终结果。');
    }

    await finalizeAssistantOutput(finalOutput, modeUsed, scratch);
}

async function executeWorkflowFrom(scratch: ScratchData, modeUsed: WorkflowMode, options: WorkflowExecutionOptions = {}) {
    const runnableWorkflow = getRunnableWorkflow();
    const assetNameMap = buildAssetNameMap(runnableWorkflow);
    let reachedStart = !options.startStepId;

    for (const step of runnableWorkflow) {
        if (!reachedStart) {
            if (step.id !== options.startStepId) {
                continue;
            }
            reachedStart = true;
        }

        runState.currentStepId = step.id;
        setStepStatus(step.id, 'in_progress');
        runState.status = `正在执行${step.title}...`;
        await tick();

        const rounds = step.rounds && step.rounds > 1 ? step.rounds : 1;
        const firstRound = step.id === options.startStepId
            ? Math.min(rounds, Math.max(1, options.startRoundIndex || 1))
            : 1;

        for (let index = firstRound; index <= rounds; index++) {
            runState.failedStepId = step.id;
            runState.failedRoundIndex = index;

            const rawOutput = await runQuietStage(step, scratch, { revisionIndex: index, revisionCount: rounds });
            let output = rawOutput;
            let meta = step.description || '已完成';

            if (step.isEditTool === true) {
                const editResult = applyAssetEdit(rawOutput, scratch, getStepOutputVarName(step, assetNameMap));
                scratch.outputs = editResult.outputs;
                scratch.lastOutput = editResult.lastOutput;

                output = scratch.lastOutput;
                const editedSummary = editResult.editedVarNames.length
                    ? `已应用 ${editResult.appliedCount} 处编辑：${editResult.editedVarNames.map(name => `{{${name}}}`).join('、')}`
                    : '未应用编辑';
                const skippedSummary = editResult.skippedEdits.length
                    ? ` · 已跳过 ${editResult.skippedEdits.length} 处：${editResult.skippedEdits.join('；')}`
                    : '';
                meta = `${meta} · ${editedSummary}${skippedSummary}`;
                pushEvent(
                    editResult.skippedEdits.length ? 'error' : 'tool',
                    editResult.skippedEdits.length ? '增量编辑部分跳过' : '增量编辑已应用',
                    rawOutput,
                    `匹配 ${editResult.matchCount} 处，更新 ${editResult.editedVarNames.join(', ') || '无'}${skippedSummary}`
                );
            } else {
                const outputVarName = saveStepOutput(step, scratch, rawOutput, assetNameMap);
                meta = step.description || `已保存为 {{${outputVarName}}}`;
            }

            const phaseTitle = rounds > 1 ? `${step.title} ${index}/${rounds}` : step.title;
            pushEvent('thinking', phaseTitle, output, meta || '该环节已执行。');
            await tick();
        }

        syncRunArtifacts(scratch);
        setStepStatus(step.id, 'completed');
        await tick();
    }

    if (!reachedStart && options.startStepId) {
        throw new Error('找不到可继续的工作流环节，请重新开始本轮 Alyce。');
    }

    await finalizeScratch(scratch, modeUsed);
}

function handleWorkflowFailure(error: any, scratch: ScratchData) {
    if (runState.failedStepId) {
        setStepStatus(runState.failedStepId, 'error');
    }

    runState.currentStepId = null;
    runState.isRunning = false;
    runState.statusKind = 'error';
    runState.status = error?.message ? `Alyce 失败：${error.message}` : 'Alyce 失败。';
    syncRunArtifacts(scratch);
    runState.canResume = Boolean(String(scratch.input || '').trim());
    pushEvent('error', '运行失败', error?.message || String(error), '可以点击继续从中断处恢复，或点击重新开始从头再跑一次。');
    console.error('[Alyce]', error);
    toastr.error(error?.message || 'Alyce 运行失败。');
}

export async function runAlyceTurn(inputText: string, modeUsed: WorkflowMode, options: { clearMainInput?: boolean, messageAlreadySent?: boolean } = {}) {
    if (runState.isRunning) {
        toastr.info('Alyce 正在处理中。');
        return;
    }

    if (!ensureChatContext()) return;

    const trimmedInput = String(inputText || '').trim();
    if (!trimmedInput) {
        toastr.warning('请先输入内容。');
        return;
    }

    if (!settingsState.workflow.some(step => step.enabled !== false)) {
        toastr.warning('请至少启用一个 Alyce 环节。');
        return;
    }

    resetRunState(modeUsed, trimmedInput);
    pushEvent('user', '已捕获用户输入', trimmedInput, '只有最终答案会写回聊天。');
    await tick();

    const scratch: ScratchData = {
        input: trimmedInput,
        outputs: {},
        lastOutput: '',
    };

    try {
        if (!options.messageAlreadySent) {
            await sendMessageAsUser(trimmedInput, '');
            if (options.clearMainInput) {
                const textarea = document.getElementById('send_textarea') as HTMLTextAreaElement;
                if (textarea) {
                    textarea.value = '';
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
            pushEvent('system', '用户消息已写入', '这条用户消息已经进入当前 SillyTavern 聊天记录。', 'Alyce 的中间步骤仍保持隐藏，最终回复会写回正常 AI 楼层。');
        } else {
            pushEvent('system', '已接管当前楼层生成', 'Alyce 正在后台执行多阶段流程。', '最终回复会作为正常 assistant 消息写回当前聊天楼层。');
        }
        await tick();

        await executeWorkflowFrom(scratch, modeUsed);
        toastr.success('Alyce 已完成本轮处理。');
    } catch (error: any) {
        handleWorkflowFailure(error, scratch);
    }
}

export async function resumeAlyceTurn() {
    if (runState.isRunning) {
        toastr.info('Alyce 正在处理中。');
        return;
    }

    if (!runState.canResume || !runState.lastScratch) {
        toastr.warning('当前没有可以继续的 Alyce 运行。');
        return;
    }

    if (!ensureChatContext()) return;

    if (!settingsState.workflow.some(step => step.enabled !== false)) {
        toastr.warning('请至少启用一个 Alyce 环节。');
        return;
    }

    const failedStepId = runState.failedStepId;
    const failedRoundIndex = runState.failedRoundIndex || 1;
    const modeUsed = runState.modeUsed || settingsState.mode;
    const scratch = cloneScratchData(runState.lastScratch);

    runState.isRunning = true;
    runState.statusKind = 'running';
    runState.status = 'Alyce 正在从中断处继续。';
    runState.canResume = false;
    await tick();

    try {
        if (failedStepId) {
            const failedStep = getRunnableWorkflow().find(step => step.id === failedStepId);
            if (!failedStep) {
                throw new Error('找不到可继续的工作流环节，请重新开始本轮 Alyce。');
            }
            pushEvent('system', '继续执行', `从「${failedStep.title}」第 ${failedRoundIndex} 轮继续。`, '已保留中断前完成的资产。');
            await tick();
            await executeWorkflowFrom(scratch, modeUsed, { startStepId: failedStepId, startRoundIndex: failedRoundIndex });
        } else {
            pushEvent('system', '继续写回最终输出', '工作流环节已经完成，正在重新尝试写回最终输出。', '已保留中断前完成的资产。');
            await tick();
            await finalizeScratch(scratch, modeUsed);
        }
        toastr.success('Alyce 已继续完成本轮处理。');
    } catch (error: any) {
        handleWorkflowFailure(error, scratch);
    }
}

export async function restartAlyceTurn() {
    if (runState.isRunning) {
        toastr.info('Alyce 正在处理中。');
        return;
    }

    const input = String(runState.lastInput || '').trim();
    if (!input) {
        toastr.warning('当前没有可以重新开始的 Alyce 输入。');
        return;
    }

    await runAlyceTurn(input, runState.modeUsed || settingsState.mode, { messageAlreadySent: true });
}
