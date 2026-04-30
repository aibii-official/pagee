import type { ContentBlock, ContentExtractorPlugin } from '../../shared/types';
import { blockTypeForElement, cleanText, createBaseContent, elementSelector, textFromBlocks } from '../utils';

const NOISE_SELECTOR = [
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'nav',
  'header',
  'footer',
  'aside',
  '[aria-hidden="true"]',
  '[hidden]'
].join(',');

const TEXT_SELECTOR = 'main article section h1,h2,h3,h4,p,blockquote,pre,code,li,td,th,figcaption';

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

function collectVisibleBlocks(document: Document): ContentBlock[] {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(TEXT_SELECTOR));
  const seen = new Set<string>();

  return elements
    .filter((element) => isVisible(element) && !element.closest(NOISE_SELECTOR))
    .map((element, index) => ({
      id: `b${index + 1}`,
      type: blockTypeForElement(element),
      text: cleanText(element.innerText || element.textContent),
      selector: elementSelector(element)
    }))
    .filter((block) => {
      if (block.text.length < 3 || seen.has(block.text)) {
        return false;
      }

      seen.add(block.text);
      return true;
    })
    .slice(0, 240);
}

export const visibleTextExtractor: ContentExtractorPlugin = {
  id: 'visible-text',
  name: 'Visible Text Fallback',
  version: '1.0.0',
  priority: 1,
  contentTypes: ['generic'],
  matches() {
    return true;
  },
  async extract(ctx) {
    const blocks = collectVisibleBlocks(ctx.document);
    const text = textFromBlocks(blocks, ctx.document.body?.innerText);

    if (!text) {
      throw new Error('No visible text could be extracted.');
    }

    return createBaseContent(ctx, 'visible-text', 'generic', text, blocks, { source: 'visible-dom-text' });
  }
};
