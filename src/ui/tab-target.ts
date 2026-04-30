import { RuntimeMessage, type PageStateSnapshot } from '../shared/messages';

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

export async function getLiveTabTarget(target: ActiveTabTarget): Promise<ActiveTabTarget> {
  if (!target.tabId) {
    return target;
  }

  try {
    const state = (await chrome.tabs.sendMessage(target.tabId, { type: RuntimeMessage.GetPageState })) as PageStateSnapshot | undefined;
    if (!state) {
      return target;
    }

    return {
      ...target,
      url: state.url || target.url,
      title: state.title || target.title
    };
  } catch {
    return target;
  }
}

export async function getActiveTabTarget(): Promise<ActiveTabTarget> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return getLiveTabTarget(targetFromTab(tab));
}

export async function getActiveTabTargetForWindow(windowId: number): Promise<ActiveTabTarget> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return getLiveTabTarget(targetFromTab(tab));
}
