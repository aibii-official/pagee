import type { ContentExtractorPlugin } from '../shared/types';
import { cleanMultilineText, createBaseContent } from './utils';

export const selectionExtractor: ContentExtractorPlugin = {
  id: 'selection',
  name: 'Selection',
  version: '1.0.0',
  priority: 100,
  contentTypes: ['selection'],
  matches(ctx) {
    return Boolean(ctx.selectionText?.trim());
  },
  async extract(ctx) {
    const text = cleanMultilineText(ctx.selectionText);
    if (!text) {
      throw new Error('No selected text found.');
    }

    return createBaseContent(
      ctx,
      'selection',
      'selection',
      text,
      [
        {
          id: 'b1',
          type: 'paragraph',
          text,
          source: 'selection'
        }
      ],
      { source: 'window.getSelection' }
    );
  }
};
