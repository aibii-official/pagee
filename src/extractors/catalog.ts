export interface ExtractorCatalogItem {
  id: string;
  name: string;
  description: string;
  defaultPriority: number;
  builtIn: boolean;
}

export const BUILT_IN_EXTRACTORS: ExtractorCatalogItem[] = [
  {
    id: 'selection',
    name: 'Selection',
    description: 'Uses the current selected text and always takes priority when present.',
    defaultPriority: 100,
    builtIn: true
  },
  {
    id: 'declarative-rule',
    name: 'Declarative Rules',
    description: 'Interprets built-in and user-provided CSS selector rule packs without executing remote code.',
    defaultPriority: 70,
    builtIn: true
  },
  {
    id: 'pdf-file',
    name: 'PDF File',
    description: 'Extracts text from user-selected local PDF files in the extension UI.',
    defaultPriority: 80,
    builtIn: true
  },
  {
    id: 'generic-readability',
    name: 'Readability Article',
    description: 'Extracts article-like pages with Mozilla Readability.',
    defaultPriority: 30,
    builtIn: true
  },
  {
    id: 'visible-text',
    name: 'Visible Text Fallback',
    description: 'Falls back to cleaned visible page text when structured extractors are low quality.',
    defaultPriority: 1,
    builtIn: true
  }
];
