import { RuntimeMessage, type ContentRequest, type ContentExtractionResponse } from '../shared/messages';
import { runExtractors } from '../extractors/registry';

const READY_KEY = '__PAGEE_CONTENT_SCRIPT_READY__';
const pageWindow = window as unknown as Window & Record<string, boolean | undefined>;

if (!pageWindow[READY_KEY]) {
  pageWindow[READY_KEY] = true;

  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
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

      sendResponse(result satisfies ContentExtractionResponse);
    })().catch((error) => {
      sendResponse({ error: (error as Error).message });
    });

    return true;
  });
}
