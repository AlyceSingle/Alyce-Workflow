# Alyce-Workflow

## TS+Vue 重构版

已将原单文件拓展抽取重构为基于 TypeScript、Vue 3 和 Vite 的工程架构，核心结构更清晰、UI 组件与逻辑分离。使用 `Reactive` 管理流程与设置状态栈。

### 开发构建指南

1. 进入当前目录:  
`cd public/scripts/extensions/third-party/Alyce-Workflow`

2. 安装依赖:  
`npm install`

3. 重新编译:  
`npm run build`

> **注意：**编译产物将被直接覆盖在当前根目录下（`index.js` 及 `style.css`），从而被 SillyTavern 加载，切勿直接修改编译后的根源文件。源码保存在 `src` 文件夹。
