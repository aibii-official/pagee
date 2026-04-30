# Pagee

> 一个纯前端 Chrome 扩展，用于页面摘要、本地记忆和个人知识搜索。

[English](./README.md)

Pagee 是一个早期阶段的 Chrome MV3 扩展，用于对当前浏览页面做摘要、把摘要保存在本地，并逐步形成浏览器侧的个人知识记忆。它不依赖后端服务：页面抽取、模型请求、摘要保存和历史搜索都运行在扩展和本地浏览器中。

## 当前状态

Pagee 目前已经可以作为本地开发扩展使用，但还不是成熟的商店级产品。当前重点是提升页面定位、官方模型 API、抽取器行为和本地记忆识别的可靠性。

## 功能

- 从 popup 或 Chrome side panel 摘要当前页面。
- 通过右键菜单摘要选中文本。
- 在侧边栏摘要 PDF。Pagee 会先尝试读取 Chrome 中已经打开的 PDF，如果被 Chrome 阻止，再用文件选择兜底。
- 使用支持视觉输入的模型理解 PDF 页图、图表、截图和扫描版/纯图片 PDF。
- 侧边栏工作区会跟随当前激活 tab 和 SPA URL 变化。
- 长内容摘要会显示抽取、分块、模型请求、综合和保存进度。
- 在本地 IndexedDB 保存摘要、抽取内容元信息、主题、实体和版本。
- 在 Knowledge 页面搜索本地摘要历史。
- 在 Options 页面本地配置 provider 和 API Key。
- 在侧边栏摘要前直接选择 provider 和模型。
- 使用内置模型目录，按 provider/model 应用对应请求参数。
- 通过内部 extractor registry 做页面抽取。
- 支持导入声明式 CSS selector 规则，不执行远程 JavaScript。
- 支持英文/中文界面切换。

## 支持的模型服务

Pagee 只面向官方云端 API。默认不使用本地模型、自建代理或第三方模型中转平台。

当前内置 provider：

- OpenAI Official
- Anthropic Official
- Google Gemini Official
- DeepSeek Official
- Moonshot/Kimi Official
- Alibaba Qwen/DashScope Official
- Zhipu GLM Official

模型选择是按 provider 绑定的下拉列表，不再是自由输入框。部分 provider/model 对参数非常严格，Pagee 会在模型目录中声明对应策略，例如省略不支持的采样参数、使用 `max_completion_tokens`，或对 Kimi 模型附加 `thinking` 设置。

## 页面抽取

Pagee 使用内部提取器插件系统：

- `selection`：选中文本，最高优先级。
- `declarative-rule`：内置和用户提供的 JSON selector 规则。
- `pdf-file`：在扩展界面中解析已打开或用户选择的 PDF 文件，为视觉模型渲染所有 PDF 页，并在需要时分批摘要。
- `generic-readability`：基于 Mozilla Readability 的文章抽取。
- `visible-text`：清洗后的可见文本兜底。

目前内置声明式规则覆盖 Medium、Substack 和 GitHub 风格的可读页面。

## 本地记忆

Pagee 使用 Dexie 管理 IndexedDB，保存：

- 文档记录
- 摘要版本
- 抽取内容记录
- 抽取日志
- 知识节点/关系的基础表结构

为了识别“同一个页面是否已经总结过”，Pagee 会做 URL 规范化，包括移除常见跟踪参数、移除 hash、清理尾斜杠，以及统一 `twitter.com` 和 `x.com`。

## 隐私模型

- 没有 Pagee 后端。
- API Key 保存在 `chrome.storage.local`。
- 抽取文本由扩展直接发送到你选择的官方模型服务。
- 摘要和历史保存在本地浏览器。
- 扩展只为官方 API endpoint 请求 provider host permission。
- 浏览器扩展本地存储不等同于后端级别的密钥保护。

## 安装

```bash
npm install
npm run build
```

然后在 Chrome 中加载扩展：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择生成的 `dist/` 目录。

开发模式：

```bash
npm run dev
```

## 配置

1. 打开 Pagee Options。
2. 选择一个官方 API provider。
3. 填入 API Key。
4. 启用该 provider。
5. 从模型下拉列表中选择默认模型。
6. 打开侧边栏，对当前页面生成摘要。

侧边栏会监听配置变化，新启用的 provider/model 通常不需要关闭重开即可出现。

## 脚本

```bash
npm run dev        # 启动 Vite 开发模式
npm run build      # 类型检查并构建扩展
npm run typecheck  # 只运行 TypeScript 检查
npm run preview    # Vite preview
```

## 架构

```txt
src/
  background/        # MV3 service worker、tab 定位、API 请求路由
  content/           # 页面抽取运行时
  extractors/        # 提取器注册表、内置提取器、声明式规则
  llm/               # provider 适配器、提示词、模型目录
  storage/           # chrome.storage 设置与 IndexedDB repository
  shared/            # 共享类型、运行时消息、URL 规范化
  ui/                # popup、side panel、options、knowledge 页面
```

## 当前限制

- 目前是本地开发构建，不是 Chrome Web Store 发布版本。
- 本地 PDF 直接读取取决于 Chrome 的 file URL 访问权限；如果被阻止，可以使用侧边栏文件选择兜底。
- 扫描版/纯图片 PDF 需要支持视觉输入的模型。Pagee 会把 PDF 页渲染成图片，按批次发送给标记为支持视觉的模型，再综合各批次摘要。
- 视频字幕、Twitter/X 线程等还没有做深度专用抽取器。
- 没有云同步、账号系统或后端备份。
- 知识图谱和 embedding 检索已有结构规划，但还没有完整实现。
- 即使都是 OpenAI-compatible API，不同 provider/model 的参数行为仍可能不同。

## 路线图

- 增强 X/Twitter、YouTube 字幕、PDF、文档站、论文页面的专用抽取器。
- 更完善的抽取日志和调试 UI。
- Markdown / JSON / Obsidian 导出。
- 使用官方 embedding API 的本地向量存储和相似检索。
- 基于本地记忆生成页面级 wiki / 概念页。
- 更完整的多语言界面覆盖。
