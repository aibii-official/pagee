import type { ContentExtractorPlugin, DeclarativeExtractionRule, ExtractionContext } from '../shared/types';
import githubRule from './rules/github.json';
import mediumRule from './rules/medium.json';
import substackRule from './rules/substack.json';
import {
  blocksFromSelectorMap,
  cleanText,
  createBaseContent,
  hostnameMatches,
  textFromBlocks
} from './utils';

const BUILT_IN_RULES = [substackRule, mediumRule, githubRule] as DeclarativeExtractionRule[];

export function getDefaultDeclarativeRules(): DeclarativeExtractionRule[] {
  return BUILT_IN_RULES;
}

function matchingRule(ctx: ExtractionContext, rules: DeclarativeExtractionRule[]): DeclarativeExtractionRule | undefined {
  return rules.find((rule) => rule.matches.some((pattern) => hostnameMatches(pattern, ctx.hostname)));
}

function queryText(root: ParentNode, selector?: string): string | undefined {
  if (!selector) return undefined;
  const element = root.querySelector(selector) as HTMLElement | null;
  return cleanText(element?.innerText || element?.textContent) || undefined;
}

export function createDeclarativeRuleExtractor(userRules: DeclarativeExtractionRule[]): ContentExtractorPlugin {
  const rules = [...userRules, ...BUILT_IN_RULES];

  return {
    id: 'declarative-rule',
    name: 'Declarative Rules',
    version: '1.0.0',
    priority: 70,
    contentTypes: ['article', 'generic'],
    matches(ctx) {
      return Boolean(matchingRule(ctx, rules));
    },
    async extract(ctx) {
      const rule = matchingRule(ctx, rules);
      if (!rule) {
        throw new Error('No matching declarative rule.');
      }

      const source = ctx.document.querySelector(rule.selectors.content);
      if (!source) {
        throw new Error(`Rule ${rule.id} did not match content selector ${rule.selectors.content}.`);
      }

      const contentRoot = source.cloneNode(true) as HTMLElement;
      rule.remove?.forEach((selector) => {
        contentRoot.querySelectorAll(selector).forEach((element) => element.remove());
      });

      const blocks = blocksFromSelectorMap(contentRoot, rule.blockSelectors);
      const text = textFromBlocks(blocks, contentRoot.textContent || undefined);

      if (!text) {
        throw new Error(`Rule ${rule.id} produced empty content.`);
      }

      return {
        ...createBaseContent(ctx, 'declarative-rule', rule.contentType, text, blocks, {
          ruleId: rule.id,
          ruleVersion: rule.version,
          source: 'declarative-json-rule'
        }),
        title: queryText(ctx.document, rule.selectors.title) || ctx.document.title || 'Untitled page',
        author: queryText(ctx.document, rule.selectors.author),
        publishedAt: queryText(ctx.document, rule.selectors.publishedAt),
        siteName: queryText(ctx.document, rule.selectors.siteName) || ctx.hostname
      };
    }
  };
}
