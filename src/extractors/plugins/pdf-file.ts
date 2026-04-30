import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { sha256 } from '../../shared/hash';
import { isSupportedImageDataUrl } from '../../shared/media';
import type { ContentBlock, ContentMedia, ExtractedContent } from '../../shared/types';
import { cleanMultilineText, finalizeContent } from '../utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfInfo {
  Title?: string;
  Author?: string;
  CreationDate?: string;
}

interface PdfFileExtractionInput {
  file: File;
  sourceUrl?: string;
}

interface PdfDataExtractionInput {
  data: ArrayBuffer | Uint8Array;
  fileName: string;
  fileSize?: number;
  source: 'file-input' | 'url-fetch';
  sourceUrl?: string;
  fallbackTitle?: string;
}

interface PdfPageProxyLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}

const MAX_RENDERED_IMAGE_WIDTH = 1100;
const PDF_PAGE_IMAGE_QUALITY = 0.72;

function isTextItem(item: unknown): item is { str: string; hasEOL?: boolean } {
  return typeof item === 'object' && item !== null && 'str' in item && typeof (item as { str?: unknown }).str === 'string';
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || fileName;
}

function fileNameFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const lastSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || 'document.pdf');
    return lastSegment || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

function messageForPdfError(error: unknown): string {
  const message = (error as Error).message || String(error);
  if (/password/i.test(message)) {
    return 'This PDF appears to be password protected. Password-protected PDFs are not supported yet.';
  }

  return message;
}

async function renderPageImage(page: PdfPageProxyLike, pageNumber: number): Promise<ContentMedia | undefined> {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_RENDERED_IMAGE_WIDTH / viewport.width, 1.6);
  const scaledViewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    return undefined;
  }

  canvas.width = Math.ceil(scaledViewport.width);
  canvas.height = Math.ceil(scaledViewport.height);
  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', PDF_PAGE_IMAGE_QUALITY);
  if (!isSupportedImageDataUrl(dataUrl)) {
    return undefined;
  }

  return {
    id: `pdf-page-image-${pageNumber}`,
    type: 'image',
    mimeType: 'image/jpeg',
    dataUrl,
    source: `Page ${pageNumber}`,
    pageNumber,
    description: `Rendered PDF page ${pageNumber}`
  };
}

async function extractPdfData(input: PdfDataExtractionInput): Promise<ExtractedContent> {
  try {
    const data = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
    const pdf = await loadingTask.promise;
    const metadata = await pdf.getMetadata().catch(() => undefined);
    const info = metadata && 'info' in metadata ? (metadata.info as PdfInfo) : undefined;
    const blocks: ContentBlock[] = [];
    const media: ContentMedia[] = [];
    let selectableTextLength = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = cleanMultilineText(
        textContent.items
          .map((item) => {
            if (!isTextItem(item)) {
              return '';
            }

            return item.hasEOL ? `${item.str}\n` : `${item.str} `;
          })
          .join('')
      );

      if (pageText) {
        selectableTextLength += pageText.length;
        blocks.push({
          id: `p${pageNumber}`,
          type: 'paragraph',
          text: pageText,
          source: `Page ${pageNumber}`
        });
      } else {
        blocks.push({
          id: `p${pageNumber}-visual`,
          type: 'image',
          text: `Visual-only PDF page. Use image attachment pdf-page-image-${pageNumber}.`,
          source: `Page ${pageNumber}`
        });
      }

      const image = await renderPageImage(page, pageNumber);
      if (image) {
        media.push(image);
      }
    }

    const text = cleanMultilineText(blocks.map((block) => `[${block.source}]\n${block.text}`).join('\n\n'));

    if (selectableTextLength === 0 && media.length === 0) {
      throw new Error('No selectable text or renderable page images were found in this PDF.');
    }

    const contentHash = await sha256([text, ...media.map((item) => item.dataUrl ?? '')].join('\n'));
    const url = input.sourceUrl || `local-pdf://${contentHash.slice(0, 24)}/${encodeURIComponent(input.fileName)}`;
    const title = cleanMultilineText(info?.Title) || cleanMultilineText(input.fallbackTitle) || titleFromFileName(input.fileName);

    const content = finalizeContent({
      extractorId: 'pdf-file',
      url,
      title,
      author: cleanMultilineText(info?.Author) || undefined,
      publishedAt: cleanMultilineText(info?.CreationDate) || undefined,
      siteName: input.sourceUrl?.startsWith('file:') || !input.sourceUrl ? 'Local PDF' : 'PDF',
      contentType: 'pdf',
      text,
      blocks,
      media,
      metadata: {
        source: input.source,
        sourceUrl: input.sourceUrl,
        fileName: input.fileName,
        fileSize: input.fileSize,
        pageCount: pdf.numPages,
        selectableTextLength,
        renderedPageImageCount: media.length,
        contentHash
      }
    });

    if (content.text.length > 100_000) {
      content.quality.warnings.push('This PDF is very large; summarization may require multiple model calls or higher context models.');
    }

    if (media.length > 0) {
      content.quality.warnings.push('PDF page images are available for vision-capable models and will be summarized in batches when needed.');
    }

    return content;
  } catch (error) {
    throw new Error(messageForPdfError(error));
  }
}

export async function extractPdfFile({ file, sourceUrl }: PdfFileExtractionInput): Promise<ExtractedContent> {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error('Choose a PDF file to summarize.');
  }

  return extractPdfData({
    data: await file.arrayBuffer(),
    fileName: file.name,
    fileSize: file.size,
    source: 'file-input',
    sourceUrl
  });
}

export async function extractPdfUrl(url: string, fallbackTitle?: string): Promise<ExtractedContent> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok && response.status !== 0) {
    throw new Error(`PDF request failed with status ${response.status}.`);
  }

  const data = await response.arrayBuffer();
  if (data.byteLength === 0) {
    throw new Error('The opened PDF could not be read or was empty.');
  }

  return extractPdfData({
    data,
    fileName: fileNameFromUrl(url),
    fileSize: data.byteLength,
    source: 'url-fetch',
    sourceUrl: url,
    fallbackTitle
  });
}
