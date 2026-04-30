import { isSupportedImageMimeType, supportedImageDataUrl } from '../../shared/media';
import type { ContentBlock, ContentExtractorPlugin, ContentMedia, ExtractionContext } from '../../shared/types';
import { cleanMultilineText, cleanText, finalizeContent } from '../utils';

const STATUS_PATH_RE = /^\/([^/]+)\/status\/(\d+)/;
const MAX_REPLY_BLOCKS = 40;
const MAX_CONTEXT_BLOCKS = 6;
const MIN_MEDIA_SIZE = 80;

interface StatusTarget {
  handle: string;
  statusId: string;
}

interface TweetArticleData {
  article: HTMLElement;
  statusIds: Set<string>;
  author?: string;
  handle?: string;
  text: string;
  timestamp?: string;
  links: string[];
}

function statusTargetFromUrl(value: string): StatusTarget | undefined {
  try {
    const url = new URL(value);
    const match = url.pathname.match(STATUS_PATH_RE);
    return match ? { handle: match[1], statusId: match[2] } : undefined;
  } catch {
    return undefined;
  }
}

function isXHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com');
}

function mainRoot(ctx: ExtractionContext): ParentNode {
  return ctx.document.querySelector('main[role="main"]') ?? ctx.document;
}

function articleStatusIds(article: HTMLElement): Set<string> {
  const ids = new Set<string>();
  article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]').forEach((anchor) => {
    try {
      const url = new URL(anchor.href, location.href);
      const match = url.pathname.match(STATUS_PATH_RE);
      if (match?.[2]) {
        ids.add(match[2]);
      }
    } catch {
      // Ignore malformed anchors from the host page.
    }
  });
  return ids;
}

function splitUserName(text: string): { author?: string; handle?: string } {
  const clean = cleanText(text);
  const handle = clean.match(/@([A-Za-z0-9_]+)/)?.[0];
  const author = handle ? clean.slice(0, clean.indexOf(handle)).trim() : clean;
  return { author: author || undefined, handle };
}

function linkTargets(article: HTMLElement): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  article.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.href;
    if (!href || href.includes('/photo/') || href.includes('/analytics') || href.includes('/status/')) {
      return;
    }

    if (!seen.has(href)) {
      seen.add(href);
      links.push(href);
    }
  });

  return links.slice(0, 12);
}

function tweetData(article: HTMLElement): TweetArticleData | undefined {
  const text = cleanMultilineText(
    Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'))
      .map((node) => node.innerText || node.textContent)
      .filter(Boolean)
      .join('\n')
  );
  const mediaCount = article.querySelectorAll('img[src*="twimg.com/media"], img[src*="twimg.com/ext_tw_video_thumb"]').length;

  if (!text && mediaCount === 0) {
    return undefined;
  }

  const user = splitUserName(article.querySelector<HTMLElement>('[data-testid="User-Name"]')?.innerText || '');
  return {
    article,
    statusIds: articleStatusIds(article),
    author: user.author,
    handle: user.handle,
    text,
    timestamp: article.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime,
    links: linkTargets(article)
  };
}

function normalizeImageUrl(value: string): string {
  try {
    const url = new URL(value, location.href);
    if (url.hostname.endsWith('twimg.com') && url.searchParams.has('name')) {
      url.searchParams.set('name', 'large');
    }
    return url.href;
  } catch {
    return value;
  }
}

async function imageUrlToDataUrl(url: string): Promise<string | undefined> {
  if (url.startsWith('data:')) {
    return supportedImageDataUrl(url);
  }

  try {
    const response = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!response.ok) {
      return undefined;
    }

    const blob = await response.blob();
    const mimeType = blob.type || response.headers.get('content-type');
    if (!isSupportedImageMimeType(mimeType)) {
      return undefined;
    }

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

async function tweetMedia(tweet: TweetArticleData, role: string, blockId: string): Promise<ContentMedia[]> {
  const images = Array.from(tweet.article.querySelectorAll<HTMLImageElement>('img[src*="twimg.com/media"], img[src*="twimg.com/ext_tw_video_thumb"]'));
  const seen = new Set<string>();
  const media: ContentMedia[] = [];

  for (const image of images) {
    const width = Math.max(image.naturalWidth || 0, image.getBoundingClientRect().width);
    const height = Math.max(image.naturalHeight || 0, image.getBoundingClientRect().height);
    if (width < MIN_MEDIA_SIZE || height < MIN_MEDIA_SIZE || image.src.includes('profile_images')) {
      continue;
    }

    const url = normalizeImageUrl(image.currentSrc || image.src);
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    const dataUrl = await imageUrlToDataUrl(url);
    media.push({
      id: `${blockId}-media-${media.length + 1}`,
      type: 'image',
      mimeType: dataUrl?.match(/^data:([^;]+);/)?.[1] || 'image/jpeg',
      url,
      dataUrl,
      source: `${role} tweet media`,
      description: cleanText(image.alt || image.getAttribute('aria-label') || `${role} tweet image`),
      width: Math.round(width),
      height: Math.round(height)
    });
  }

  return media;
}

function blockText(role: string, tweet: TweetArticleData, media: ContentMedia[]): string {
  return [
    `${role}`,
    tweet.author || tweet.handle ? `Author: ${[tweet.author, tweet.handle].filter(Boolean).join(' ')}` : '',
    tweet.timestamp ? `Time: ${tweet.timestamp}` : '',
    tweet.text ? `Text:\n${tweet.text}` : 'Text: [no text, media-only tweet]',
    tweet.links.length ? `Links:\n${tweet.links.map((link) => `- ${link}`).join('\n')}` : '',
    media.length ? `Media:\n${media.map((item) => `- [${item.id}] ${item.description || item.url || 'image'}${item.url ? ` (${item.url})` : ''}`).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export const xTwitterExtractor: ContentExtractorPlugin = {
  id: 'x-twitter-status',
  name: 'X/Twitter Status',
  version: '1.0.0',
  priority: 90,
  contentTypes: ['tweet-thread'],
  matches(ctx) {
    return Boolean(isXHost(ctx.hostname) && statusTargetFromUrl(ctx.url));
  },
  async extract(ctx) {
    const target = statusTargetFromUrl(ctx.url);
    if (!target) {
      throw new Error('Current URL is not an X/Twitter status page.');
    }

    const articles = Array.from(mainRoot(ctx).querySelectorAll<HTMLElement>('article[data-testid="tweet"]'))
      .map(tweetData)
      .filter((item): item is TweetArticleData => Boolean(item));
    const mainIndex = articles.findIndex((article) => article.statusIds.has(target.statusId));

    if (mainIndex < 0) {
      throw new Error('Could not identify the main tweet article for this status page.');
    }

    const selected = [
      ...articles.slice(Math.max(0, mainIndex - MAX_CONTEXT_BLOCKS), mainIndex).map((tweet, index) => ({ role: `Context tweet ${index + 1}`, tweet })),
      { role: 'Main tweet', tweet: articles[mainIndex] },
      ...articles.slice(mainIndex + 1, mainIndex + 1 + MAX_REPLY_BLOCKS).map((tweet, index) => ({ role: `Reply ${index + 1}`, tweet }))
    ];
    const blocks: ContentBlock[] = [];
    const media: ContentMedia[] = [];

    for (const item of selected) {
      const blockId = item.role === 'Main tweet' ? 'tweet-main' : item.role.toLowerCase().replace(/\s+/g, '-');
      const blockMedia = await tweetMedia(item.tweet, item.role, blockId);
      media.push(...blockMedia);
      blocks.push({
        id: blockId,
        type: 'tweet',
        text: blockText(item.role, item.tweet, blockMedia),
        source: item.role
      });
    }

    const mainTweet = articles[mainIndex];
    const text = cleanMultilineText(blocks.map((block) => `[${block.id}]\n${block.text}`).join('\n\n'));
    const content = finalizeContent({
      extractorId: 'x-twitter-status',
      url: ctx.url,
      canonicalUrl: `https://x.com/${target.handle}/status/${target.statusId}`,
      title: ctx.document.title || `X status ${target.statusId}`,
      author: mainTweet.author || mainTweet.handle,
      publishedAt: mainTweet.timestamp,
      siteName: 'X',
      contentType: 'tweet-thread',
      text,
      blocks,
      media,
      metadata: {
        source: 'x-twitter-status-dom',
        statusId: target.statusId,
        handle: target.handle,
        contextTweetCount: Math.min(mainIndex, MAX_CONTEXT_BLOCKS),
        replyCount: Math.min(Math.max(articles.length - mainIndex - 1, 0), MAX_REPLY_BLOCKS),
        scopedMediaCount: media.length,
        skipPageMediaCollection: true,
        excludedAreas: ['right-rail recommendations', 'home timeline', 'platform suggested tweets outside main status conversation']
      }
    });

    return {
      ...content,
      quality: {
        ...content.quality,
        score: Math.max(content.quality.score, 0.82),
        warnings: [
          ...content.quality.warnings,
          'X/Twitter extractor scoped content to the status conversation: context tweets, main tweet, and visible replies.'
        ]
      }
    };
  }
};
