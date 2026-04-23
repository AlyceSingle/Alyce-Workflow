export type StepType = 'think' | 'outline' | 'draft' | 'revise' | 'final' | 'custom';

export interface WorkflowStep {
    id: string;
    type: StepType;
    title: string;
    prompt: string;
    enabled?: boolean;
    rounds?: number;
}

export interface AlyceSettings {
    enabled: boolean;
    mode: 'linear' | 'agent';
    workflow: WorkflowStep[];
}

export interface RunEvent {
    kind: 'user' | 'thinking' | 'tool' | 'assistant' | 'error' | 'system';
    badge: string;
    title: string;
    body: string;
    meta: string;
}

export interface StageOutput {
    title: string;
    body: string;
    meta: string;
}

export interface RunState {
    isRunning: boolean;
    status: string;
    statusKind: 'idle' | 'running' | 'error';
    events: RunEvent[];
    stageOutputs: StageOutput[];
    finalOutput: string;
    lastInput: string;
    lastScratch: ScratchData | null;
    currentStepId: string | null;
    stepStatuses: Record<string, string>;
    modeUsed: 'linear' | 'agent' | null;
    toolCallingNote: string | null;
}

export interface ScratchData {
    input: string;
    thinking: string;
    outline: string;
    draft: string;
    currentDraft: string;
    final: string;
}

export interface UiState {
    popup: any | null;
    root: any | null;
    selectedStepId: string;
    run: RunState;
}
