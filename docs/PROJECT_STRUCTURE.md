# Alyce-Workflow 项目架构文档

本项目已从传统的原生 JavaScript 插件迁移至现代化的 **TypeScript + Vue 3** 工程化架构。本文档旨在说明项目的目录结构及其设计逻辑。

## 1. 目录树概览

```text
Alyce-Workflow/
├── docs/                       # 项目文档
│   └── PROJECT_STRUCTURE.md    # 本文档
├── src/                        # 源代码目录（开发核心）
│   ├── main.ts                 # 插件入口：负责与 SillyTavern 握手并挂载 Vue 实例
│   ├── App.vue                 # 根组件：插件的主界面布局
│   ├── components/             # UI 组件库（可复用的界面单元）
│   │   ├── WorkflowStep.vue    # 工作流步骤组件
│   │   ├── PromptEditor.vue    # Prompt 编辑器组件
│   │   └── SettingsToggle.vue  # 开关/配置项组件
│   ├── composables/            # 逻辑封装 (Composition API)
│   │   ├── useSillyTavern.ts   # 封装 ST 原生 API 调用
│   │   └── useWorkflow.ts      # 核心工作流逻辑（原 index.js 的灵魂）
│   ├── store/                  # 状态管理
│   │   └── settings.ts         # 响应式插件设置，自动同步至 extension_settings
│   ├── types/                  # 类型定义
│   │   ├── sillytavern.d.ts    # ST 内部模块的 TS 类型声明
│   │   └── workflow.d.ts       # 工作流业务数据结构定义
│   └── assets/                 # 静态资源
│       └── style.scss          # 全局样式源文件
├── manifest.json               # SillyTavern 插件元数据（指向根目录 index.js）
├── package.json                # 项目依赖与构建脚本
├── tsconfig.json               # TypeScript 配置文件
├── vite.config.ts              # Vite 构建配置（库模式、外部依赖映射）
├── index.js                    # 【构建产物】由 Vite 生成，供 ST 加载（请勿手动修改）
└── style.css                   # 【构建产物】由 Vite 生成，供 ST 加载（请勿手动修改）
```

## 2. 核心设计理念

### 2.1 关注点分离 (Separation of Concerns)
- **UI 与逻辑解耦**：所有的界面表现都在 `.vue` 组件中处理，而复杂的业务逻辑（如思维链的执行）被抽离到 `composables/` 中。
- **状态集中管理**：插件的配置项不再散落在各处，而是统一由 `store/settings.ts` 管理，并利用 Vue 的响应式系统实现自动保存。

### 2.2 构建流程 (Build Pipeline)
项目使用 **Vite** 的 **Library Mode (库模式)** 进行构建：
1. **输入**：以 `src/main.ts` 为入口，解析整个依赖树。
2. **外部化 (External)**：SillyTavern 的全局脚本（如 `../../../script.js`）被标记为外部依赖，构建时不会被打包，而是保留引用。
3. **输出**：在根目录生成单一的 `index.js` 和 `style.css`。这确保了与 `manifest.json` 的兼容性，同时保持了根目录的整洁。

### 2.3 类型安全 (Type Safety)
通过在 `src/types/` 中定义 SillyTavern 的 API 类型，开发者可以享受完整的代码补全和静态检查，极大地降低了因拼写错误或参数误用导致的 Bug。

## 3. 开发指南

- **修改 UI**：前往 `src/components/` 或 `src/App.vue`。
- **修改逻辑**：前往 `src/composables/useWorkflow.ts`。
- **添加新设置**：在 `src/store/settings.ts` 中添加新的响应式属性。
- **执行构建**：运行 `npm run build` 以更新根目录的产物。

---
*文档维护者：Alyce*
