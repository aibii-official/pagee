# Pagee

> A pure frontend Chrome extension for page summaries, local memory, and personal knowledge search.

[简体中文](./README.zh-CN.md)

Pagee is an early-stage Chrome MV3 extension that summarizes the page you are reading, saves the result locally, and helps you build a browser-side knowledge memory. It runs without a backend server: extraction, provider calls, summary storage, and history search all happen inside the extension and your browser.

## Status

Pagee is usable as a local development extension, but it is not a polished store-ready product yet. The current focus is reliability around page targeting, official model APIs, extractor behavior, and local memory recognition.

## Features

- Summarize the active page from the popup or Chrome side panel.
- Summarize selected text from the context menu.
- Use a side panel workspace that follows the active tab and SPA URL changes.
- Save summaries, extracted content metadata, topics, entities, and versions in local IndexedDB.
- Search local summary history from the Knowledge page.
- Configure providers and API keys locally in the Options page.
- Choose provider and model directly from the side panel before summarizing.
- Use a built-in model catalog with provider/model-specific request parameters.
- Run page extraction through an internal extractor registry.
- Import declarative CSS selector rules without executing remote JavaScript.
- Switch the interface language between English and Chinese.

## Supported Providers

Pagee only targets official cloud APIs. It does not use local models, proxy servers, or third-party model routers by default.

Currently included providers:

- OpenAI Official
- Anthropic Official
- Google Gemini Official
- DeepSeek Official
- Moonshot/Kimi Official
- Alibaba Qwen/DashScope Official
- Zhipu GLM Official

The model selector is provider-aware. Models are selected from Pagee's internal catalog instead of a free-form text box. Some providers/models have strict parameter behavior; Pagee omits unsupported sampling parameters where needed and applies model-specific request fields such as `max_completion_tokens` or Kimi `thinking` settings.

## Page Extraction

Pagee uses an internal extractor plugin system:

- `selection`: selected text, highest priority.
- `declarative-rule`: built-in and user-provided JSON selector rules.
- `generic-readability`: article extraction with Mozilla Readability.
- `visible-text`: cleaned visible text fallback.

Built-in declarative rules currently cover Medium, Substack, and GitHub-style readable pages.

## Local Memory

Pagee stores local knowledge in IndexedDB with Dexie:

- documents
- summary versions
- extracted content records
- extraction logs
- knowledge node/edge placeholders

It also normalizes URLs for memory lookup, including common tracking parameter removal, hash removal, trailing slash cleanup, and `twitter.com`/`x.com` normalization.

## Privacy Model

- No Pagee backend is used.
- API keys are stored in `chrome.storage.local`.
- Extracted text is sent directly from the extension to the selected official provider.
- Summaries and history are stored locally in the browser.
- The extension requests provider host permissions only for official API endpoints.
- Browser extension storage is not equivalent to backend-grade secret protection.

## Installation

```bash
npm install
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the generated `dist/` directory.

During development:

```bash
npm run dev
```

## Configuration

1. Open Pagee Options.
2. Select an official API provider.
3. Paste your API key.
4. Enable the provider.
5. Pick the default model from the model dropdown.
6. Open the side panel and summarize the current page.

The side panel listens for settings changes, so newly enabled providers/models should appear without closing and reopening the panel.

## Scripts

```bash
npm run dev        # start Vite dev mode
npm run build      # typecheck and build the extension
npm run typecheck  # run TypeScript checks only
npm run preview    # Vite preview
```

## Architecture

```txt
src/
  background/        # MV3 service worker, tab targeting, API routing
  content/           # page extraction runtime
  extractors/        # extractor registry, built-ins, declarative rules
  llm/               # provider adapters, prompts, model catalog
  storage/           # chrome.storage settings and IndexedDB repositories
  shared/            # shared types, runtime messages, URL normalization
  ui/                # popup, side panel, options, knowledge pages
```

## Current Limitations

- This is a local development build, not a Chrome Web Store release.
- PDF support is limited to selectable/browser-visible text behavior.
- Video subtitle extraction and Twitter/X thread extraction are not specialized yet.
- There is no cloud sync, account system, or backend backup.
- Knowledge graph and embedding search are scaffolded conceptually but not fully implemented.
- API behavior can vary by provider and model even when APIs are OpenAI-compatible.

## Roadmap

- Better site-specific extractors for X/Twitter, YouTube subtitles, PDFs, docs, and papers.
- More robust extraction logs and debugging UI.
- Export to Markdown/JSON/Obsidian.
- Local embedding storage and similarity search with official embedding APIs.
- Page-level wiki/concept pages generated from accumulated local memory.
- More complete i18n coverage.
