import { getContext } from 'st-context';
import { getChatCompletionModel } from 'st-openai';
import { getTextGenModel } from 'st-textgen';
import { nai_settings } from 'st-nai';
import { kai_settings } from 'st-kai';

export function getConnectionSnapshot() {
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

export function escapeHtml(value: any) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#039;');
}

export function shorten(text: string, maxLength = 180) {
    const normalized = String(text ?? '').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, maxLength - 1) + '…';
}
