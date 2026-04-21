declare module 'st-script' {
    export function saveReply(options: { type: string, getMessage: string }): Promise<void>;
    export function sendMessageAsUser(message: string, suffix?: string): Promise<void>;
}

declare module 'st-extensions' {
    export function renderExtensionTemplateAsync(name: string, template: string, data: any): Promise<string>;
    export const extension_settings: Record<string, any>;
}

declare module 'st-popup' {
    export const POPUP_TYPE: {
        TEXT: string;
        // ... 其他属性
    };

    export class Popup {
        constructor(content: any, type: string, text: string, options: any);
        show(): Promise<any>;
    }
}

declare module 'st-context' {
    export function getContext(): {
        uuidv4?(): string;
        canPerformToolCalls?(type: 'quiet' | 'normal'): boolean;
        mainApi?: string;
        chatCompletionSettings?: any;
        textCompletionSettings?: any;
        getCurrentChatId?(): string | number;
        chatId?: string | number;
        groupId?: string | number;
        characterId?: number;
        chat: any[];
        saveSettingsDebounced(): void;
        generateQuietPrompt(options: { quietPrompt: string }): Promise<string>;
        saveChat(): Promise<void>;
    };
}

declare module 'st-openai' {
    export function getChatCompletionModel(settings: any): string;
}

declare module 'st-textgen' {
    export function getTextGenModel(settings: any): string;
}

declare module 'st-nai' {
    export const nai_settings: any;
}

declare module 'st-kai' {
    export const kai_settings: any;
}

declare global {
    var alyceGenerateInterceptor: (chat: any[], contextSize: number, abort: (val: boolean) => void, type: string) => Promise<void>;
    var alyceDeleteCustomStep: (stepId: string) => void;
    var toastr: {
        info(msg: string): void;
        warning(msg: string): void;
        success(msg: string): void;
        error(msg: string): void;
    };
}

export {};
