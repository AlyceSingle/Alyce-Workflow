# Alyce-Workflow 状态持久化与资产命名方案

## 1. 核心理念：上下文黑板 (Blackboard Pattern)
为了实现多阶段的“接力式”创作，我们需要将每个环节的输出转化为可被后续环节引用的“资产（Assets）”。

## 2. 改进点：自定义引用名称 (Custom Asset Naming)
目前工作流默认使用 `step.id` 作为引用键名（例如 `{{step_123}}`），这不直观。我们建议在 `WorkflowStep` 类型中增加 `outputVarName` 字段。

### 数据结构调整 (`src/types/workflow.d.ts`)
```typescript
export interface WorkflowStep {
    id: string;
    title: string;
    description?: string;
    prompt: string;
    enabled: boolean;
    rounds: number;
    // 新增：自定义输出变量名，例如 "article" 或 "thought"
    outputVarName?: string; 
}
```

## 3. 运行逻辑：资产的保存与覆盖
在 `runAlyceTurn` 循环中，我们需要确保输出被正确地存入指定的变量名中。

### 逻辑实现 (`src/composables/useWorkflow.ts`)
```typescript
for (const step of getRunnableWorkflow()) {
    // ... 执行生成逻辑 ...
    const output = await runQuietStage(step, scratch, ...);

    // 确定保存的键名：优先使用用户定义的变量名，否则回退到 step.id
    const varName = (step.outputVarName && step.outputVarName.trim()) || step.id;
    
    // 保存到黑板中
    // 如果是编辑环节，只要 varName 相同，就会自动覆盖旧内容，实现“活文档”
    scratch.outputs[varName] = output;
    scratch.lastOutput = output;
    
    // ...
}
```

## 4. 实际应用场景示例

### 环节 A：思维链生成
- **标题**: 构思大纲
- **变量名**: `thought`
- **输出**: "本文应分为三个部分..."
- **状态**: `scratch.outputs['thought']` 被赋值。

### 环节 B：正文初稿
- **标题**: 撰写正文
- **变量名**: `article`
- **Prompt**: "参考思维链：{{thought}}，请开始写作..."
- **输出**: "在遥远的未来..."
- **状态**: `scratch.outputs['article']` 被赋值。

### 环节 C：工具化编辑
- **标题**: 细节润色
- **变量名**: `article` (注意：这里使用相同的变量名)
- **Prompt**: "当前正文：{{article}}。请使用工具格式进行修改..."
- **输出**: (修改后的全文或增量内容)
- **状态**: `scratch.outputs['article']` 被更新为修改后的版本。

### 环节 D：最终检查
- **标题**: 终审
- **Prompt**: "请检查最终版本：{{article}}..."
- **状态**: 此时读取到的 `{{article}}` 已经是环节 C 处理过的最新结果。

## 5. 结论
通过引入 `outputVarName`，我们实现了：
1. **语义化引用**：用户可以使用 `{{article}}` 而不是晦涩的 ID。
2. **自动状态更新**：通过重用变量名，后续环节永远能拿到“最新且唯一”的正确状态。
3. **内存级持久化**：无需物理文件，在整个工作流生命周期内保持数据一致。
