export interface WorkflowStep {
    id: string;
    title: string;
    description: string;
    prompt: string;
    enabled: boolean;
    rounds: number;
    outputVarName?: string;
    isEditTool?: boolean;
}

export interface AlyceSettings {
    enabled: boolean;
    mode: 'linear' | 'agent';
    finalOutputTemplate: string;
    workflow: WorkflowStep[];
}

export interface RunEvent {
    kind: 'user' | 'thinking' | 'tool' | 'assistant' | 'error' | 'system';
    badge: string;
    title: string;
    body: string;
    meta: string;
}

export interface RunState {
    isRunning: boolean;
    status: string;
    statusKind: 'idle' | 'running' | 'error';
    events: RunEvent[];
    finalOutput: string;
    lastInput: string;
    lastScratch: ScratchData | null;
    currentStepId: string | null;
    stepStatuses: Record<string, string>;
    modeUsed: 'linear' | 'agent' | null;
}

export interface ScratchData {
    input: string;
    outputs: Record<string, string>;
    lastOutput: string;
}
