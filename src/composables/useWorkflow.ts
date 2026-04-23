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

export function syncRunArtifacts(scratch: ScratchData) {
    runState.lastScratch = structuredClone(scratch);
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

    for (const step of settingsState.workflow) {
        runState.stepStatuses[step.id] = step.enabled === false ? 'skipped' : 'pending';
    }
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

export async function runQuietStage(step: WorkflowStep, scratch: ScratchData, options = {}) {
    const context = getContext();
    const promptTemplate = buildStepPromptTemplate(step, scratch);
    const prompt = interpolateTemplate(promptTemplate, buildInterpolationMap(step, scratch, options));
    const result = await context.generateQuietPrompt({ 
        quietPrompt: prompt,
        quietToLoud: true, 
        skipWIAN: true, // 避免一些无关注入
    });
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

export async function finalizeAssistantOutput(output: string, modeUsed: 'linear' | 'agent', scratch: ScratchData) {
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
            })),
            finalOutputTemplate: settingsState.finalOutputTemplate,
            generatedAt: new Date().toISOString(),
        };
    }

    await context.saveChat();

    runState.finalOutput = output;
    runState.lastScratch = scratch;
    runState.status = 'Alyce 已完成，并把最终答案写回聊天。';
    runState.statusKind = 'idle';
    runState.isRunning = false;
}

export async function runAlyceTurn(inputText: string, modeUsed: 'linear' | 'agent', options: { clearMainInput?: boolean, messageAlreadySent?: boolean } = {}) {
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

        const runnableWorkflow = getRunnableWorkflow();
        const assetNameMap = buildAssetNameMap(runnableWorkflow);

        for (const step of runnableWorkflow) {
            runState.currentStepId = step.id;
            setStepStatus(step.id, 'in_progress');
            runState.status = `正在执行${step.title}...`;
            await tick();

            const rounds = step.rounds && step.rounds > 1 ? step.rounds : 1;

            for (let index = 1; index <= rounds; index++) {
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

        runState.currentStepId = null;
        const finalOutput = resolveFinalOutput(scratch);
        if (!String(finalOutput).trim()) {
            throw new Error('Alyce 生成了空的最终结果。');
        }
        await finalizeAssistantOutput(finalOutput, modeUsed, scratch);
        toastr.success('Alyce 已完成本轮处理。');
    } catch (error: any) {
        runState.currentStepId = null;
        runState.isRunning = false;
        runState.statusKind = 'error';
        runState.status = error?.message ? `Alyce 失败：${error.message}` : 'Alyce 失败。';
        syncRunArtifacts(scratch);
        pushEvent('error', '运行失败', error?.message || String(error), '如有需要，请到浏览器控制台查看详细信息。');
        console.error('[Alyce]', error);
        toastr.error(error?.message || 'Alyce 运行失败。');
    }
}
