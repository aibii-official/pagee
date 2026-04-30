import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Pagee Knowledge Summarizer',
  short_name: 'Pagee',
  version: '0.1.0',
  description: 'A pure frontend Chrome extension for page summaries, local memory, and personal knowledge search.',
  permissions: ['activeTab', 'contextMenus', 'sidePanel', 'scripting', 'storage', 'tabs', 'webNavigation'],
  optional_host_permissions: [
    'https://api.openai.com/*',
    'https://api.anthropic.com/*',
    'https://generativelanguage.googleapis.com/*',
    'https://api.deepseek.com/*',
    'https://api.moonshot.cn/*',
    'https://dashscope.aliyuncs.com/*',
    'https://open.bigmodel.cn/*',
    'file:///*'
  ],
  action: {
    default_popup: 'src/ui/popup/index.html',
    default_title: 'Summarize with Pagee'
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ],
  options_page: 'src/ui/options/index.html',
  side_panel: {
    default_path: 'src/ui/sidepanel/index.html'
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'"
  }
});
