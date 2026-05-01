import type { UiLanguage } from '../shared/types';

type MessageKey =
  | 'actionItems'
  | 'apiKeysLocal'
  | 'apiProvider'
  | 'baseUrl'
  | 'bullets'
  | 'chatModel'
  | 'choosePdf'
  | 'claims'
  | 'clearKnowledge'
  | 'confidence'
  | 'configureApi'
  | 'contentExtraction'
  | 'defaultProvider'
  | 'defaultProviderHint'
  | 'detailedSummary'
  | 'directPdfReadFailed'
  | 'enabled'
  | 'enabledCount'
  | 'extractingPdf'
  | 'extractorHint'
  | 'interfaceLanguage'
  | 'keyPlaceholder'
  | 'knowledge'
  | 'language'
  | 'localMemory'
  | 'memorySeeds'
  | 'modelOverrideHint'
  | 'moreDetailed'
  | 'moreTechnical'
  | 'noEnabledProvider'
  | 'openKnowledge'
  | 'openQuestions'
  | 'openWorkspaceToImportPdf'
  | 'openWorkspace'
  | 'options'
  | 'pdfHint'
  | 'pdfTarget'
  | 'privacy'
  | 'providerPermissionDenied'
  | 'providerSettings'
  | 'quotedEvidence'
  | 'quickSummary'
  | 'saveOptions'
  | 'savedLocally'
  | 'selectProvider'
  | 'settingsSaved'
  | 'shorter'
  | 'simpler'
  | 'summaryLanguage'
  | 'summaryMode'
  | 'summaryPreferences'
  | 'summarizeActivePage'
  | 'summarizePdf'
  | 'summarizing'
  | 'tldr'
  | 'workspace'
  | 'modeShort'
  | 'modeMedium'
  | 'modeLong'
  | 'modeStudy'
  | 'modeResearch';

const messages: Record<UiLanguage, Record<MessageKey, string>> = {
  en: {
    actionItems: 'Action Items',
    apiKeysLocal: 'API keys are stored locally and sent directly to the selected official provider.',
    apiProvider: 'API provider',
    baseUrl: 'Base URL',
    bullets: 'Key Points',
    chatModel: 'Chat model',
    choosePdf: 'Choose PDF',
    claims: 'Claims',
    clearKnowledge: 'Clear Local Knowledge',
    confidence: 'Confidence',
    configureApi: 'Configure API',
    contentExtraction: 'Content Extraction',
    defaultProvider: 'Use as default provider',
    defaultProviderHint: 'Enabled providers can also be selected directly in the side panel before summarizing.',
    detailedSummary: 'Detailed Summary',
    directPdfReadFailed: 'Could not read the opened PDF directly.',
    enabled: 'Enabled',
    enabledCount: 'Enabled',
    extractingPdf: 'Extracting PDF...',
    extractorHint: 'Built-in extractors and JSON selector rules. Rule packs never execute remote JavaScript.',
    interfaceLanguage: 'Interface language',
    keyPlaceholder: 'Paste API key',
    knowledge: 'Knowledge',
    language: 'Language',
    localMemory: 'Local memory',
    memorySeeds: 'Memory Seeds',
    modelOverrideHint: 'Change the model for this run without opening Options.',
    moreDetailed: 'More detailed',
    moreTechnical: 'More technical',
    noEnabledProvider: 'No enabled provider. Configure one official API first.',
    openKnowledge: 'Open Knowledge',
    openQuestions: 'Open Questions',
    openWorkspaceToImportPdf: 'Open the workspace to summarize the PDF. Pagee can try the opened PDF first and fall back to file selection.',
    openWorkspace: 'Open Workspace',
    options: 'Options',
    pdfHint: 'Pagee will first try to read the PDF already open in Chrome. It extracts selectable text and renders page images for vision-capable models. If Chrome blocks direct access, use Choose PDF as the local fallback.',
    pdfTarget: 'PDF target',
    privacy: 'Privacy and Local Storage',
    providerPermissionDenied: 'Permission was not granted for this provider.',
    providerSettings: 'Provider Settings',
    quotedEvidence: 'Quoted Evidence',
    quickSummary: 'Quick Summary',
    saveOptions: 'Save Options',
    savedLocally: 'Settings saved locally.',
    selectProvider: 'Select provider',
    settingsSaved: 'Settings saved locally.',
    shorter: 'Shorter',
    simpler: 'Simpler',
    summaryLanguage: 'Summary language',
    summaryMode: 'Summary mode',
    summaryPreferences: 'Summary Preferences',
    summarizeActivePage: 'Summarize Active Page',
    summarizePdf: 'Summarize PDF',
    summarizing: 'Summarizing...',
    tldr: 'TLDR',
    workspace: 'Workspace',
    modeShort: 'Brief',
    modeMedium: 'Standard',
    modeLong: 'Deep',
    modeStudy: 'Study',
    modeResearch: 'Research'
  },
  zh: {
    actionItems: '行动项',
    apiKeysLocal: 'API Key 仅保存在本地，并直接发送到所选官方模型服务。',
    apiProvider: 'API 服务商',
    baseUrl: 'Base URL',
    bullets: '关键要点',
    chatModel: '对话模型',
    choosePdf: '选择 PDF',
    claims: '关键论断',
    clearKnowledge: '清空本地知识库',
    confidence: '置信度',
    configureApi: '配置 API',
    contentExtraction: '内容抽取',
    defaultProvider: '设为默认服务商',
    defaultProviderHint: '已启用的服务商也可以在侧边栏摘要前直接切换。',
    detailedSummary: '详细摘要',
    directPdfReadFailed: '无法直接读取当前已打开的 PDF。',
    enabled: '启用',
    enabledCount: '已启用',
    extractingPdf: '正在提取 PDF...',
    extractorHint: '内置抽取器与 JSON selector 规则包。规则包不会执行远程 JavaScript。',
    interfaceLanguage: '界面语言',
    keyPlaceholder: '粘贴 API Key',
    knowledge: '知识库',
    language: '语言',
    localMemory: '本地记忆',
    memorySeeds: '记忆种子',
    modelOverrideHint: '可在不打开设置页的情况下，为本次摘要临时切换模型。',
    moreDetailed: '更详细',
    moreTechnical: '更技术',
    noEnabledProvider: '还没有启用服务商，请先配置一个官方 API。',
    openKnowledge: '打开知识库',
    openQuestions: '开放问题',
    openWorkspaceToImportPdf: '打开工作区摘要 PDF。Pagee 会先尝试读取已打开的 PDF，失败时再用文件选择兜底。',
    openWorkspace: '打开工作区',
    options: '设置',
    pdfHint: 'Pagee 会先尝试读取 Chrome 中已经打开的 PDF，并提取可选中文本、为视觉模型渲染页图。如果 Chrome 阻止直接访问，可以用“选择 PDF”作为本地兜底。',
    pdfTarget: 'PDF 目标',
    privacy: '隐私与本地存储',
    providerPermissionDenied: '未获得该服务商的访问权限。',
    providerSettings: '服务商设置',
    quotedEvidence: '引用证据',
    quickSummary: '快速摘要',
    saveOptions: '保存设置',
    savedLocally: '设置已保存到本地。',
    selectProvider: '选择服务商',
    settingsSaved: '设置已保存到本地。',
    shorter: '更短',
    simpler: '更通俗',
    summaryLanguage: '摘要语言',
    summaryMode: '摘要模式',
    summaryPreferences: '摘要偏好',
    summarizeActivePage: '摘要当前页面',
    summarizePdf: '摘要 PDF',
    summarizing: '摘要中...',
    tldr: '一句话总结',
    workspace: '工作区',
    modeShort: '简要概述',
    modeMedium: '标准摘要',
    modeLong: '深度分析',
    modeStudy: '学习模式',
    modeResearch: '研究模式'
  }
};

export function t(language: UiLanguage | undefined, key: MessageKey): string {
  return messages[language ?? 'en'][key];
}
