const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'source',
  'spm',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term'
]);

export function isHttpPageUrl(url?: string): boolean {
  return Boolean(url?.startsWith('http://') || url?.startsWith('https://'));
}

export function isFilePdfUrl(value?: string): boolean {
  if (!value?.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol.toLowerCase() === 'file:' && decodeURIComponent(url.pathname).toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

export function isPdfLikeUrl(value?: string): boolean {
  if (!value?.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname).toLowerCase().endsWith('.pdf');
  } catch {
    return value.trim().replace(/[?#].*$/, '').toLowerCase().endsWith('.pdf');
  }
}

function normalizeHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return host === 'twitter.com' ? 'x.com' : host;
}

export function normalizeUrlForLookup(value?: string): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = normalizeHost(url.hostname);
    url.protocol = url.protocol.toLowerCase();

    for (const key of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();

    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    return url.toString();
  } catch {
    return value.trim().replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

export function urlLookupCandidates(...values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => [value, normalizeUrlForLookup(value)])
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function urlsMatchForLookup(left?: string, right?: string): boolean {
  const leftCandidates = urlLookupCandidates(left);
  const rightCandidates = urlLookupCandidates(right);
  return leftCandidates.some((candidate) => rightCandidates.includes(candidate));
}
