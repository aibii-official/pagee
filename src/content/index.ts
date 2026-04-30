import { RuntimeMessage, type ContentRequest, type ContentExtractionResponse, type PageStateSnapshot } from '../shared/messages';
import { runExtractors } from '../extractors/registry';
import { collectPageMedia } from '../extractors/page-media';

const READY_KEY = '__PAGEE_CONTENT_SCRIPT_READY__';
const pageWindow = window as unknown as Window & Record<string, boolean | undefined>;

function readPageState(): PageStateSnapshot {
  return {
    url: window.location.href,
    title: document.title || window.location.href,
    timestamp: Date.now()
  };
}

if (!pageWindow[READY_KEY]) {
  pageWindow[READY_KEY] = true;
  let lastStateKey = '';

  function publishPageStateIfChanged() {
    const state = readPageState();
    const stateKey = `${state.url}\n${state.title}`;

    if (stateKey === lastStateKey) {
      return;
    }

    lastStateKey = stateKey;
    void chrome.runtime.sendMessage({ type: RuntimeMessage.PageStateChanged, ...state }).catch(() => undefined);
  }

  const observer = new MutationObserver(publishPageStateIfChanged);
  const titleElement = document.querySelector('title');
  if (titleElement) {
    observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
  }

  window.addEventListener('popstate', publishPageStateIfChanged);
  window.addEventListener('hashchange', publishPageStateIfChanged);
  window.setInterval(publishPageStateIfChanged, 500);
  publishPageStateIfChanged();

  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    if (message?.type === RuntimeMessage.GetPageState) {
      sendResponse(readPageState());
      return false;
    }

    if (message?.type !== RuntimeMessage.ExtractContent) {
      return false;
    }

    void (async () => {
      const selectionText = message.selectionText ?? window.getSelection()?.toString() ?? undefined;
      const result = await runExtractors(
        {
          url: window.location.href,
          hostname: window.location.hostname,
          document,
          selectionText,
          language: document.documentElement.lang || undefined
        },
        message.settings
      );

      if (result.content.contentType !== 'selection') {
        const mediaResult = await collectPageMedia(document);
        const { media } = mediaResult;
        if (media.length > 0) {
          result.content = {
            ...result.content,
            media: [...(result.content.media ?? []), ...media],
            metadata: {
              ...result.content.metadata,
              pageMediaCount: media.length,
              pageMediaCoverage: mediaResult.coverage,
              pageMediaReachedPageEnd: mediaResult.reachedPageEnd
            },
            quality: {
              ...result.content.quality,
              warnings: [...result.content.quality.warnings, `${media.length} page image(s) are available for vision-capable models; coverage=${mediaResult.coverage}.`]
            }
          };
        }
      }

      sendResponse(result satisfies ContentExtractionResponse);
    })().catch((error) => {
      sendResponse({ error: (error as Error).message });
    });

    return true;
  });
}
