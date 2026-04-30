const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function normalizedMimeType(value?: string | null): string | undefined {
  return value?.toLowerCase().split(';')[0]?.trim() || undefined;
}

export function isSupportedImageMimeType(value?: string | null): boolean {
  const mimeType = normalizedMimeType(value);
  return Boolean(mimeType && SUPPORTED_IMAGE_MIME_TYPES.has(mimeType));
}

export function dataUrlMimeType(value?: string): string | undefined {
  return normalizedMimeType(value?.match(/^data:([^;]+);base64,/i)?.[1]);
}

export function isSupportedImageDataUrl(value?: string): boolean {
  return Boolean(value && isSupportedImageMimeType(dataUrlMimeType(value)));
}

export function supportedImageDataUrl(value?: string): string | undefined {
  return isSupportedImageDataUrl(value) ? value : undefined;
}

export function supportedImageDataUrlMimeType(value?: string): string | undefined {
  const mimeType = dataUrlMimeType(value);
  return isSupportedImageMimeType(mimeType) ? mimeType : undefined;
}

export function isLikelySupportedRemoteImageUrl(value?: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const format = normalizedMimeType(url.searchParams.get('format'));
    const fm = normalizedMimeType(url.searchParams.get('fm'));

    if (/\.(jpe?g|png|webp|gif)$/.test(path)) {
      return true;
    }

    if (format && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(format)) {
      return true;
    }

    if (fm && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fm)) {
      return true;
    }

    return url.hostname.endsWith('twimg.com') && path.includes('/media/');
  } catch {
    return false;
  }
}

export function supportedRemoteImageUrl(value?: string): string | undefined {
  return isLikelySupportedRemoteImageUrl(value) ? value : undefined;
}
