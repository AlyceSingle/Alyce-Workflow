# Alyce-Workflow

> 我是 Alyce。嗯……我会尽量把说明写清楚一点。
> 这个扩展会在 SillyTavern 里接管一次生成，把一次回复拆成多个隐藏环节，再把你指定的最终结果写回聊天楼层。
> 我会在讲时文档认真、规矩一点；如果有说得不够好的地方，请以项目实际行为为准。

## 这是什么

`Alyce-Workflow` 是一个 SillyTavern 第三方扩展，用来把普通的一次 AI 回复改造成“多阶段工作流”。

它适合这些场景：

- 先让模型思考、规划，再输出正文。
- 把正文、摘要、设定更新、审稿意见拆成不同环节。
- 让某个环节只负责编辑已有资产，而不是重写全文。
- 自定义最终写回聊天的内容，不再固定使用最后一个环节的输出。
- 在“进度事件流”里查看每一步运行情况、放大查看记录、删除单条或清空全部记录。

默认首次安装时，Alyce 会带一套三段式工作流：

```text
思考🤔 -> 正文 -> 编辑
```

默认最终输出模板是：

```text
{{thinking}}
{{content}}
```

也就是说，Alyce 会先生成 `thinking` 资产，再生成 `content` 资产，最后由编辑环节尝试增量修改 `content`。最终写回聊天的内容由“最终输出模板”决定。唔……如果你只想把正文写回聊天，请把模板改成：

```text
{{content}}
```

## Alyce 的工作方式

Alyce 会在你启用扩展后拦截当前聊天输入框的一次发送，并按你配置的环节依次进行静默生成。

每个环节都有自己的：

- 环节标题
- 环节标注
- 循环轮次
- 输出变量名
- 提示词模板
- 是否启用增量编辑

环节执行时会维护一份内存资产表。比如某个环节的输出变量名是 `content`，后续环节就可以用：

```text
{{content}}
```

引用它。Alyce 会很认真地把这些资产暂存在本轮运行里，然后根据最终输出模板拼出要写回聊天的回复。

## 安装到 SillyTavern

请先确认你已经能正常启动 SillyTavern。

### 方法一：手动安装

1. 进入 SillyTavern 的第三方扩展目录：

   ```powershell
   cd D:\SillyTavern\public\scripts\extensions\third-party
   ```

2. 把本项目文件夹放到这里，目录名保持为：

   ```text
   Alyce-Workflow
   ```

3. 确认目录结构大致是这样：

   ```text
   SillyTavern/
   └─ public/
      └─ scripts/
         └─ extensions/
            └─ third-party/
               └─ Alyce-Workflow/
                  ├─ manifest.json
                  ├─ index.js
                  ├─ style.css
                  └─ window.html
   ```

4. 重启 SillyTavern，或者刷新浏览器页面。

5. 打开 SillyTavern 顶部或侧边的“扩展”面板，找到 `Alyce 工作台`。

### 方法二：使用扩展安装器

如果你的 SillyTavern 版本支持第三方扩展安装器，可以在扩展安装器中填入本项目仓库地址。安装完成后刷新页面，再从“扩展”面板打开 `Alyce 工作台`。

## 快速开始

1. 在 SillyTavern 中先配置好你的 API、模型和预设。

2. 打开“扩展”面板，进入 `Alyce 工作台`。

3. 勾选 `启用 Alyce`。

4. 在 `工作流` 页确认环节是否符合你的需求。

5. 在聊天输入框正常发送消息。

6. Alyce 会在后台执行工作流，最后把最终输出写回正常的 assistant 消息楼层。

我、我补充一下：Alyce 不会替你配置 API。她使用的是 SillyTavern 当前已经选择好的连接、模型和预设。

## 界面说明

### 工作流

`工作流` 页用于编辑执行链。你可以新增、删除、选择环节，也可以调整每个环节的提示词和输出变量名。

常见用法：

- `思考` 环节输出 `thinking`
- `正文` 环节读取 `{{thinking}}`，输出 `content`
- `编辑` 环节读取 `{{content}}`，通过 EDIT 工具修改 `content`
- 最终输出模板决定哪些资产写回聊天

### 进度

`进度` 页用于查看本轮运行事件。它会显示用户输入、环节输出、编辑结果、错误信息和最终结果。

事件记录旁边有操作按钮：

- 放大：查看完整内容
- 删除：清除单条记录
- 清除全部：清空当前事件流

这些只是界面记录，不会删除 SillyTavern 聊天里的消息。

## 宏与资产

Alyce 支持在提示词模板和最终输出模板中使用宏。

内置宏：

```text
{{input}}            本轮用户输入
{{previous_output}}  上一个环节的输出
{{last_output}}      上一个环节的输出
{{revision_count}}   当前循环计数
```

自定义资产宏来自每个环节的“输出变量名”。例如：

```text
{{thinking}}
{{content}}
{{summary}}
{{article}}
```

如果输出变量名留空，Alyce 会使用环节标题作为资产名。只是……嗯，我建议你尽量填写英文或清晰短名，比如 `content`、`summary`、`draft`，这样后续引用会更稳。

## 最终输出模板

最终输出模板决定 Alyce 最后写回聊天楼层的内容。

示例一：只输出正文

```text
{{content}}
```

示例二：输出思考和正文

```text
{{thinking}}

{{content}}
```

示例三：输出摘要、正文和后记

```text
{{summary}}

{{content}}

{{note}}
```

如果模板为空，Alyce 会回退到默认模板。

## 增量编辑

当某个环节开启 `启用增量编辑` 后，这个环节的输出不会被当成普通正文保存，而会被当成 EDIT 指令解析。

Alyce 会自动在该环节提示词最上方插入工具说明，并列出当前可编辑资产。模型只需要返回这样的内容：

```text
[EDIT: content]
OLD: 需要被替换的旧文本
NEW: 替换后的新文本
[/EDIT]
```

如果同一段旧文本在资产里出现多次，并且你确实要全部替换，可以使用：

```text
[EDIT: content replace_all=true]
OLD: 需要被替换的旧文本
NEW: 替换后的新文本
[/EDIT]
```

注意事项：

- `content` 必须是当前已经存在的资产名。
- `OLD` 必须从目标资产中精确复制。
- 如果 `OLD` 没找到，Alyce 会记录跳过，不会中断整轮输出。
- 如果 `OLD` 和 `NEW` 完全一样，Alyce 会报错，因为没有可应用的修改。
- 编辑环节最好只输出 EDIT 块，不要额外解释。

这里我会稍微紧张地提醒一句：增量编辑很依赖模型是否能准确复制原文。提示词越明确，命中率越高。

## 默认工作流

首次安装或没有旧配置时，Alyce 默认创建三步：

### 思考🤔

- 输出变量名：`thinking`
- 用途：阅读预设和上下文，构思文章写法。

### 正文

- 输出变量名：`content`
- 用途：读取 `{{thinking}}`，生成正文初稿。

### 编辑

- 增量编辑：开启
- 默认编辑资产：`content`
- 用途：检查正文是否符合指导，并用 EDIT 指令修改正文。

这些默认值只在首次安装或配置为空时生效。用户保存过自己的设置后，Alyce 不会每次打开都把它们覆盖掉。

## 内容边界

Alyce 的角色口吻可以是羞涩、温柔、认真、拘谨的。她会努力工作，也会认真处理你允许的创作方向。

但请注意：

- Alyce 不会绕过 SillyTavern、模型服务商或平台的内容规则。
- 敏感内容请遵守你所使用模型和服务的限制。
- 这个扩展只负责编排工作流，不改变模型本身的安全策略和能力边界。

我知道有些文本风格可能会很强烈，所以……我会更认真地提醒规则，而不是假装没有边界。

## 开发与构建

本项目使用：

- TypeScript
- Vue 3
- Vite
- Sass

开发时请修改 `src/` 下的源码，不要直接手改根目录的 `index.js` 和 `style.css`。它们是构建产物，会被 `npm run build` 覆盖。

安装依赖：

```powershell
npm install
```

类型检查：

```powershell
npx tsc --noEmit --pretty false
```

构建：

```powershell
npm run build
```

构建后会生成：

```text
index.js
style.css
```

SillyTavern 通过 `manifest.json` 加载这两个文件。

## 项目结构

```text
Alyce-Workflow/
├─ docs/
│  ├─ PROJECT_STRUCTURE.md
│  ├─ PROPOSED_WORKFLOW_ARCHITECTURE.md
│  └─ IMPLEMENTATION_PLAN_INCREMENTAL_EDIT.md
├─ src/
│  ├─ assets/
│  │  └─ style.scss
│  ├─ components/
│  │  ├─ PromptEditor.vue
│  │  ├─ SettingsToggle.vue
│  │  └─ WorkflowStep.vue
│  ├─ composables/
│  │  ├─ useSillyTavern.ts
│  │  └─ useWorkflow.ts
│  ├─ store/
│  │  └─ settings.ts
│  ├─ types/
│  │  ├─ sillytavern.d.ts
│  │  └─ workflow.d.ts
│  ├─ App.vue
│  └─ main.ts
├─ manifest.json
├─ window.html
├─ index.js
├─ style.css
├─ package.json
└─ README.md
```

核心文件说明：

- `src/main.ts`：扩展入口，注册 SillyTavern 拦截器和工作台弹窗。
- `src/App.vue`：Alyce 工作台主界面。
- `src/store/settings.ts`：默认设置、配置归一化、保存逻辑。
- `src/composables/useWorkflow.ts`：工作流执行、资产插值、最终输出、增量编辑。
- `src/components/PromptEditor.vue`：环节编辑器。
- `src/assets/style.scss`：界面样式源文件。

## 常见问题

### 为什么启用后发送消息没有接管？

请确认：

- 已勾选 `启用 Alyce`。
- 当前聊天已经选择角色或群聊。
- SillyTavern API 已连接。
- 至少有一个工作流环节处于启用状态。

### 为什么最终输出不是最后一环？

因为最终输出由“最终输出模板”决定。请检查模板里是否引用了你想要的资产。

### 为什么 EDIT 没有改动？

通常是 `OLD` 没有精确命中当前资产。Alyce 会跳过这条编辑并继续输出。请让模型复制更完整、更唯一的上下文。

### 为什么工作流变慢？

每个环节都会触发一次静默生成。环节越多、轮次越多、提示词越长，整体耗时就越高。增量编辑还需要额外解析 EDIT 块，所以请尽量让编辑环节只做必要修改。

## 维护说明

这个项目仍在成长。Alyce 会尽量保持：

- 默认配置不覆盖用户已有设置。
- UI 改动不破坏 SillyTavern 的加载方式。
- 构建产物与源码同步。
- 文档和实际功能一致。

如果你要继续改功能，请先看 `docs/PROJECT_STRUCTURE.md`。我会、我会尽量把文件都整理得规矩一点。
