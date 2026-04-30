export interface ActiveTabTarget {
  tabId?: number;
  windowId?: number;
  url?: string;
  title?: string;
}

export function targetFromTab(tab?: chrome.tabs.Tab): ActiveTabTarget {
  return {
    tabId: tab?.id,
    windowId: tab?.windowId,
    url: tab?.url,
    title: tab?.title
  };
}

export async function getActiveTabTarget(): Promise<ActiveTabTarget> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return targetFromTab(tab);
}

export async function getActiveTabTargetForWindow(windowId: number): Promise<ActiveTabTarget> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return targetFromTab(tab);
}
