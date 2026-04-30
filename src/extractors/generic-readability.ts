import { Readability } from '@mozilla/readability';
import type { ContentExtractorPlugin } from '../shared/types';
import { blocksFromElement, cleanMultilineText, createBaseContent } from './utils';

export const genericReadabilityExtractor: ContentExtractorPlugin = {
  id: 'generic-readability',
  name: 'Readability Article',
  version: '1.0.0',
  priority: 30,
  contentTypes: ['article'],
  matches() {
    return true;
  },
  async extract(ctx) {
    const clone = ctx.document.cloneNode(true) as Document;
    const article = new Readability(clone).parse();

    if (!article?.textContent) {
      throw new Error('Readability could not find article content.');
    }

    const container = ctx.document.createElement('article');
    container.innerHTML = article.content || '';
    const blocks = blocksFromElement(container);
    const text = cleanMultilineText(blocks.map((block) => block.text).join('\n\n') || article.textContent);

    return {
      ...createBaseContent(ctx, 'generic-readability', 'article', text, blocks, {
        excerpt: article.excerpt,
        readabilityTitle: article.title,
        source: 'mozilla-readability'
      }),
      title: article.title || ctx.document.title || 'Untitled page',
      author: article.byline || undefined,
      siteName: article.siteName || undefined
    };
  }
};
