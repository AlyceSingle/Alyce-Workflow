# 增量编辑与动态资产管理实装计划

## 1. 目标
实现类似 `AlyceAgent` 的 `FileEditTool` 功能，允许 AI 通过特定指令对内存中的资产（如 `{{article}}`）进行增量修改，而非全量重写。

## 2. 核心变更点

### 阶段一：数据结构升级 (Types)
- **文件**: `src/types/workflow.d.ts`
- **变更**: 
    - 为 `WorkflowStep` 增加 `outputVarName?: string`，允许用户自定义输出变量名。
    - 为 `WorkflowStep` 增加 `isEditTool?: boolean`，标记该环节是否为“编辑模式”。

### 阶段二：资产管理逻辑 (Store)
- **文件**: `src/store/settings.ts`
- **变更**: 
    - 更新 `normalizeStep` 函数，确保新字段能正确初始化和保存。
    - 在 UI 中增加对应的输入框，让用户可以设置变量名。

### 阶段三：核心编辑引擎 (Composables)
- **文件**: `src/composables/useWorkflow.ts`
- **变更**: 
    - **实现 `applyAssetEdit` 函数**: 
        - 借鉴 `AlyceAgent` 的逻辑，支持 `[EDIT: varName] OLD: ... NEW: ... [/EDIT]` 格式。
        - 使用 `String.replace` 或 `split/join` 实现精准替换。
    - **改造 `runAlyceTurn` 循环**:
        - 在每个环节结束后，根据 `outputVarName` 自动更新 `scratch.outputs`。
        - 如果环节标记为 `isEditTool`，则在保存前先运行 `applyAssetEdit`。

### 阶段四：UI 与交互 (Components)
- **文件**: `src/components/PromptEditor.vue`
- **变更**: 
    - 增加“输出变量名”配置项。
    - 增加“启用增量编辑”开关。

## 3. 预期的 AI 指令格式
AI 将被引导使用如下格式进行编辑：
```text
[EDIT: article]
OLD: 这里的旧内容需要被替换。
NEW: 这是替换后的新内容，更加精准。
[/EDIT]
```

## 4. 验证流程
1. **环节 1**: 生成文章，设置变量名为 `article`。
2. **环节 2**: 引用 `{{article}}`，并输出 `[EDIT: article]` 指令。
3. **环节 3**: 再次引用 `{{article}}`，验证其内容是否已变为环节 2 修改后的版本。

## 5. 后续扩展
- 支持 `replace_all` 参数。
- 增加编辑冲突的错误提示（如找不到 `OLD` 文本时）。
