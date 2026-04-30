# Extractor Architecture

Pagee uses two extractor implementation styles: declarative JSON rules and TypeScript code extractors.

## Selection Rule

Use the smallest implementation that can reliably preserve the page's semantic boundary.

Use a JSON rule when:

- The site has stable DOM structure.
- A CSS selector can identify the content root.
- Title, author, timestamp, and blocks can be expressed with selectors.
- No SPA state, media scoping, pagination, authentication side effects, or context disambiguation is required.
- The rule only needs `matches`, `selectors`, `remove`, and `blockSelectors`.

Use a TypeScript extractor when:

- The page contains multiple similar content units and requires a semantic boundary decision.
- The extractor needs URL parsing, SPA state, conversation/thread context, or media scoping.
- The page mixes main content with recommendations, comments, sidebars, feeds, or unrelated cards.
- The extractor needs multi-step work such as PDF rendering, lazy-loaded media handling, screenshots, or provider-specific metadata.
- The extraction quality depends on custom validation or fallback logic.

## Directory Layout

- `src/extractors/rules/*.json`: declarative selector rule packs.
- `src/extractors/plugins/*.ts`: TypeScript extractor implementations and extractor-specific helpers.
- `src/extractors/declarative-rule-extractor.ts`: the safe interpreter for JSON rules.
- `src/extractors/manifest.ts`: the central registry for TypeScript extractors and extractor catalog metadata.
- `src/extractors/registry.ts`: runtime composition of code extractors, declarative rules, and fallbacks.
- `src/extractors/utils.ts`: shared extractor utilities used by both rules and plugins.

## Runtime Priority

The default order is:

1. User selection (`selection`)
2. High-priority code extractors, such as `x-twitter-status`
3. Declarative JSON rules (`declarative-rule`)
4. Code fallbacks, such as `generic-readability`
5. Last-resort code fallbacks, such as `visible-text`

This means explicit user intent wins, then site-specific semantic extractors, then safe selector rules, then generic fallbacks.

## Adding A JSON Rule

Add a file under `src/extractors/rules/`.

Required fields:

```json
{
  "id": "site-article",
  "version": "1.0.0",
  "matches": ["example.com", "*.example.com"],
  "contentType": "article",
  "selectors": {
    "title": "h1",
    "author": ".author",
    "publishedAt": "time",
    "content": "article"
  },
  "remove": ["nav", "footer", ".ad"],
  "blockSelectors": {
    "heading": "h2,h3",
    "paragraph": "p",
    "quote": "blockquote"
  }
}
```

Rules must not execute JavaScript. They are interpreted as data only.

## Adding A TypeScript Extractor

1. Implement `ContentExtractorPlugin` in `src/extractors/plugins/<site-or-type>.ts`.
2. Add it to `CODE_EXTRACTOR_PLUGINS_BEFORE_RULES` or `CODE_EXTRACTOR_PLUGINS_AFTER_RULES` in `src/extractors/manifest.ts`.
3. Add a matching catalog item to `CODE_EXTRACTOR_CATALOG_ITEMS` in `src/extractors/manifest.ts`.
4. Prefer `BEFORE_RULES` only when the extractor understands a semantic boundary better than selector rules.
5. Add metadata that explains coverage, excluded page regions, and media scope.

Required behavior for code extractors:

- `matches(ctx)` must be cheap and specific.
- `extract(ctx)` must avoid unrelated recommendations, navigation, and sidebars.
- Media attachments must be scoped to the selected content, not the whole page, unless the extractor explicitly documents full-page coverage.
- Metadata should record what was included and excluded.
- Extraction should return block IDs that can be cited by summaries.

## Current TypeScript Extractors

- `selection`: selected text, highest priority.
- `x-twitter-status`: X/Twitter status conversation, excluding recommendations and unrelated timelines.
- `pdf-file`: PDF import/opened-PDF parsing in the UI, including text and page-image rendering.
- `generic-readability`: generic article extraction.
- `visible-text`: final visible-text fallback.

## Current JSON Rule Sites

- Medium
- Substack
- GitHub readable pages
