import { reactive } from 'vue';
import { getContext } from 'st-context';
import { sendMessageAsUser, saveReply } from 'st-script';
import { settingsState, saveSettings, getRevisionRounds } from '../store/settings';
import { getToolCallingSnapshot, shorten } from './useSillyTavern';
import type { RunState, ScratchData, WorkflowStep, StepType } from '../types/workflow';

export const runState = reactive<RunState>({
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

export function addStageOutput(title: string, body: string, meta = '') {
    runState.stageOutputs.push({ title, body, meta });
}

export function setStepStatus(stepId: string, status: string) {
    runState.stepStatuses[stepId] = status;
}

export function syncRunArtifacts(scratch: ScratchData) {
    runState.lastScratch = structuredClone(scratch);
    if (scratch.final) {
        runState.finalOutput = scratch.final;
    }
}

export function resetRunState(modeUsed: 'linear' | 'agent', inputText: string) {
    runState.isRunning = true;
    runState.statusKind = 'running';
    runState.status = 'Alyce 已开始处理。';
    runState.events = [];
    runState.stageOutputs = [];
    runState.finalOutput = '';
    runState.lastInput = inputText;
    runState.lastScratch = null;
    runState.currentStepId = null;
    runState.stepStatuses = {};
    runState.modeUsed = modeUsed;
    runState.toolCallingNote = getToolCallingSnapshot().note;

    for (const step of settingsState.workflow) {
        runState.stepStatuses[step.id] = step.enabled === false ? 'skipped' : 'pending';
    }
}

export function buildInterpolationMap(step: WorkflowStep, scratch: ScratchData, extra: any = {}) {
    return {
        input: scratch.input,
        thinking: scratch.thinking,
        outline: scratch.outline,
        draft: scratch.draft,
        current_draft: scratch.currentDraft,
        revision_count: String(extra.revisionCount ?? (step.type === 'revise' ? getRevisionRounds(step) : 0)),
        revision_index: String(extra.revisionIndex ?? ''),
        step_title: step.title,
    };
}

export function interpolateTemplate(template: string, values: Record<string, string>) {
    return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(values[key] ?? ''));
}

async function tick() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

export async function runQuietStage(step: WorkflowStep, scratch: ScratchData, options = {}) {
    const context = getContext();
    const prompt = interpolateTemplate(step.prompt, buildInterpolationMap(step, scratch, options));
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
                type: step.type,
                title: step.title,
                rounds: step.type === 'revise' ? getRevisionRounds(step) : undefined,
            })),
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
        thinking: '',
        outline: '',
        draft: '',
        currentDraft: '',
        final: '',
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

        for (const step of getRunnableWorkflow()) {
            runState.currentStepId = step.id;
            setStepStatus(step.id, 'in_progress');
            runState.status = `正在执行${step.title}...`;
            await tick();

            if (step.type === 'think') {
                scratch.thinking = await runQuietStage(step, scratch);
                addStageOutput(step.title, scratch.thinking, '内部工作笔记');
                pushEvent('thinking', step.title, scratch.thinking, '隐藏思考阶段已完成。');
            } else if (step.type === 'outline') {
                scratch.outline = await runQuietStage(step, scratch);
                addStageOutput(step.title, scratch.outline, '粗略大纲');
                pushEvent('thinking', step.title, scratch.outline, '结构分析已完成。');
            } else if (step.type === 'draft') {
                scratch.draft = await runQuietStage(step, scratch);
                scratch.currentDraft = scratch.draft;
                addStageOutput(step.title, scratch.draft, '第一版初稿');
                pushEvent('assistant', step.title, scratch.draft, '第一版工作初稿已生成。');
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
                        pushEvent('tool', `${step.title} ${index}/${revisionRounds}`, revised, `第 ${index} / ${revisionRounds} 轮整改。`);
                        await tick();
                    }
                }
            } else if (step.type === 'final') {
                scratch.final = await runQuietStage(step, scratch);
                addStageOutput(step.title, scratch.final, '终稿封装');
                pushEvent('assistant', step.title, scratch.final, '最终答案已准备完成。');
            } else {
                const transformed = await runQuietStage(step, scratch);
                scratch.currentDraft = transformed;
                addStageOutput(step.title, transformed, '自定义处理');
                pushEvent('tool', step.title, transformed, '自定义环节已完成。');
            }

            syncRunArtifacts(scratch);
            setStepStatus(step.id, 'completed');
            await tick();
        }

        runState.currentStepId = null;
        const finalOutput = scratch.final || scratch.currentDraft || scratch.draft || '';
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

export async function runAgentFollowup(promptText: string) {
    const followup = String(promptText || '').trim();
    if (!followup) {
        toastr.warning('请输入补充指令。');
        return;
    }
    await runAlyceTurn(followup, 'agent');
}
