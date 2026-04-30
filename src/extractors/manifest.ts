import type { ContentExtractorPlugin } from '../shared/types';
import { genericReadabilityExtractor } from './plugins/generic-readability';
import { selectionExtractor } from './plugins/selection';
import { visibleTextExtractor } from './plugins/visible-text';
import { xTwitterExtractor } from './plugins/x-twitter';

export interface ExtractorCatalogItem {
  id: string;
  name: string;
  description: string;
  defaultPriority: number;
  builtIn: boolean;
  implementation?: 'code' | 'declarative-rule';
  runtime?: 'content-script' | 'ui';
}

export const CODE_EXTRACTOR_PLUGINS_BEFORE_RULES: ContentExtractorPlugin[] = [selectionExtractor, xTwitterExtractor];

export const CODE_EXTRACTOR_PLUGINS_AFTER_RULES: ContentExtractorPlugin[] = [genericReadabilityExtractor, visibleTextExtractor];

export const CODE_EXTRACTOR_CATALOG_ITEMS: ExtractorCatalogItem[] = [
  {
    id: 'selection',
    name: 'Selection',
    description: 'Uses the current selected text and always takes priority when present.',
    defaultPriority: 100,
    builtIn: true,
    implementation: 'code',
    runtime: 'content-script'
  },
  {
    id: 'x-twitter-status',
    name: 'X/Twitter Status',
    description: 'Extracts the focused status conversation while excluding platform recommendations and unrelated timeline tweets.',
    defaultPriority: 90,
    builtIn: true,
    implementation: 'code',
    runtime: 'content-script'
  },
  {
    id: 'pdf-file',
    name: 'PDF File',
    description: 'Extracts text and page images from opened or user-selected PDF files in the extension UI.',
    defaultPriority: 80,
    builtIn: true,
    implementation: 'code',
    runtime: 'ui'
  },
  {
    id: 'generic-readability',
    name: 'Readability Article',
    description: 'Extracts article-like pages with Mozilla Readability.',
    defaultPriority: 30,
    builtIn: true,
    implementation: 'code',
    runtime: 'content-script'
  },
  {
    id: 'visible-text',
    name: 'Visible Text Fallback',
    description: 'Falls back to cleaned visible page text when structured extractors are low quality.',
    defaultPriority: 1,
    builtIn: true,
    implementation: 'code',
    runtime: 'content-script'
  }
];

export const DECLARATIVE_RULE_CATALOG_ITEM: ExtractorCatalogItem = {
  id: 'declarative-rule',
  name: 'Declarative Rules',
  description: 'Interprets built-in and user-provided CSS selector rule packs without executing remote code.',
  defaultPriority: 70,
  builtIn: true,
  implementation: 'declarative-rule',
  runtime: 'content-script'
};

export const BUILT_IN_EXTRACTORS: ExtractorCatalogItem[] = [
  CODE_EXTRACTOR_CATALOG_ITEMS[0],
  DECLARATIVE_RULE_CATALOG_ITEM,
  ...CODE_EXTRACTOR_CATALOG_ITEMS.slice(1)
];
