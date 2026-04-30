import type { ContentMedia } from '../../shared/types';
import { dataUrlMimeType, isSupportedImageMimeType, supportedImageDataUrl } from '../../shared/media';

const MIN_IMAGE_WIDTH = 96;
const MIN_IMAGE_HEIGHT = 96;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SCROLL_HEIGHT = 120_000;
const MAX_SCROLL_STEPS = 48;
const SCROLL_SETTLE_MS = 260;

export interface PageMediaCollectionResult {
  media: ContentMedia[];
  coverage: 'loaded-dom' | 'full-page-scroll' | 'bounded-scroll';
  reachedPageEnd: boolean;
}

function cleanText(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value: string): string | undefined {
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return undefined;
  }
}

function normalizeImageUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);

    if (url.hostname.endsWith('twimg.com') && url.searchParams.has('name')) {
      url.searchParams.set('name', 'large');
    }

    return url.href;
  } catch {
    return value;
  }
}

function imageSize(image: HTMLImageElement): { width: number; height: number } {
  const rect = image.getBoundingClientRect();
  return {
    width: Math.round(Math.max(rect.width, image.naturalWidth || 0, image.width || 0)),
    height: Math.round(Math.max(rect.height, image.naturalHeight || 0, image.height || 0))
  };
}

function isMeaningfulImage(image: HTMLImageElement): boolean {
  const size = imageSize(image);
  const style = window.getComputedStyle(image);
  return size.width >= MIN_IMAGE_WIDTH && size.height >= MIN_IMAGE_HEIGHT && style.display !== 'none' && style.visibility !== 'hidden';
}

function imageDescription(image: HTMLImageElement, index: number): string {
  const aria = image.getAttribute('aria-label');
  const alt = image.alt;
  const containerText = cleanText(image.closest('article,[role="article"],figure')?.textContent).slice(0, 400);
  return cleanText(alt || aria || containerText || `Page image ${index + 1}`);
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
    const mimeType = blob.type || response.headers.get('content-type') || undefined;
    if (!isSupportedImageMimeType(mimeType)) {
      return undefined;
    }

    if (blob.size > MAX_INLINE_IMAGE_BYTES) {
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

function shouldBoundScroll(document: Document): boolean {
  const url = new URL(window.location.href);
  if ((url.hostname === 'x.com' || url.hostname === 'twitter.com') && /^\/(home|explore|search|notifications|messages)\b/.test(url.pathname)) {
    return false;
  }

  return document.documentElement.scrollHeight > window.innerHeight * 1.25;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function collectLoadedMedia(document: Document, seen: Set<string>, media: ContentMedia[]): Promise<void> {
  const images = Array.from(document.images).filter(isMeaningfulImage);

  for (const image of images) {
    const rawUrl = image.currentSrc || image.src;
    const absolute = rawUrl ? absoluteUrl(rawUrl) : undefined;
    if (!absolute) {
      continue;
    }

    const url = normalizeImageUrl(absolute);
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    const dataUrl = await imageUrlToDataUrl(url);
    const embeddedMimeType = dataUrlMimeType(dataUrl ?? '');
    const size = imageSize(image);
    media.push({
      id: `page-image-${media.length + 1}`,
      type: 'image',
      mimeType: embeddedMimeType || 'image/jpeg',
      url,
      dataUrl,
      source: 'Page image',
      description: imageDescription(image, media.length),
      width: size.width,
      height: size.height
    });
  }
}

export async function collectPageMedia(document: Document): Promise<PageMediaCollectionResult> {
  const seen = new Set<string>();
  const media: ContentMedia[] = [];
  const originalX = window.scrollX;
  const originalY = window.scrollY;
  let coverage: PageMediaCollectionResult['coverage'] = 'loaded-dom';
  let reachedPageEnd = false;

  await collectLoadedMedia(document, seen, media);

  if (!shouldBoundScroll(document)) {
    return { media, coverage, reachedPageEnd };
  }

  try {
    coverage = 'bounded-scroll';
    let previousHeight = document.documentElement.scrollHeight;

    for (let step = 0; step < MAX_SCROLL_STEPS; step += 1) {
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const nextY = Math.min(maxScrollY, Math.round(step * window.innerHeight * 0.85));
      window.scrollTo({ left: originalX, top: nextY, behavior: 'instant' });
      await sleep(SCROLL_SETTLE_MS);
      await collectLoadedMedia(document, seen, media);

      const currentHeight = document.documentElement.scrollHeight;
      reachedPageEnd = Math.ceil(window.scrollY + window.innerHeight) >= currentHeight - 4;

      if (reachedPageEnd) {
        coverage = 'full-page-scroll';
        break;
      }

      if (currentHeight > MAX_SCROLL_HEIGHT && currentHeight > previousHeight) {
        break;
      }

      previousHeight = currentHeight;
    }
  } finally {
    window.scrollTo({ left: originalX, top: originalY, behavior: 'instant' });
  }

  return { media, coverage, reachedPageEnd };
}
