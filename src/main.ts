import { createApp, type App as VueApp } from 'vue';
import { ensureSettings, settingsState } from './store/settings';
import { runAlyceTurn } from './composables/useWorkflow';
import { renderExtensionTemplateAsync } from 'st-extensions';
import { Popup, POPUP_TYPE } from 'st-popup';
import App from './App.vue';
import './assets/style.scss';

const TEMPLATE_PATH = 'third-party/Alyce-Workflow';

let vueApp: VueApp | null = null;
let popupInstance: any = null;

async function openWorkspace() {
    if (popupInstance) {
        toastr.info('Alyce 工作台已经打开。');
        return;
    }

    ensureSettings();

    const templateHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'window', {});
    const $template = $(templateHtml);

    vueApp = createApp(App);
    const mountPoint = document.createElement('div');
    $template.append(mountPoint);
    vueApp.mount(mountPoint);

    popupInstance = new Popup($template, POPUP_TYPE.TEXT, '', {
        wide: true,
        wider: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: '关闭',
        cancelButton: false,
        onClose: () => {
            if (vueApp) {
                vueApp.unmount();
                vueApp = null;
            }
            popupInstance = null;
        },
    });

    await popupInstance.show();
    requestAnimationFrame(() => {
        const workspaceElement = $template.get(0);
        const popupContent = workspaceElement?.closest('.popup-content');
        if (popupContent) {
            popupContent.scrollTo({ top: 0, behavior: 'instant' });
            popupContent.scrollTop = 0;
        }
        workspaceElement?.focus({ preventScroll: true });
    });
}

function initMenuButton() {
    const buttonHtml = `
        <div id="alyce_wand_button" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-route extensionsMenuExtensionButton"></div>
            Alyce 工作台
        </div>
    `;
    $('#extensionsMenu').append(buttonHtml);
    $('#alyce_wand_button').on('click', openWorkspace);
}

async function alyceGenerateInterceptor(chat: any[], _contextSize: number, abort: (val: boolean) => void, type: string) {
    if (!settingsState.enabled) {
        return;
    }

    // 过滤掉不应当拦截的后台静默生成或组聊生成
    const ignoredTypes = ['quiet', 'quiet_prompt', 'group_chat', 'summarize'];
    if (ignoredTypes.includes(type)) {
        return;
    }

    // 找到此前的最后一条用户消息作为代表性触发文本
    const lastUserMessage = [...chat].reverse().find(m => m.is_user);
    const messageText = lastUserMessage ? String(lastUserMessage.mes || '').trim() : '';

    abort(true);
    await runAlyceTurn(messageText, settingsState.mode, { messageAlreadySent: true });
}

Object.assign(globalThis, {
    alyceGenerateInterceptor,
});

jQuery(async () => {
    ensureSettings();
    initMenuButton();
});
