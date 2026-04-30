import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ExtractionQuality, SummaryResult, UiLanguage } from '../../shared/types';
import { t } from '../i18n';

function MarkdownText({ children, inline = false }: { children: string; inline?: boolean }) {
  return (
    <ReactMarkdown
      className={inline ? undefined : 'markdown-body'}
      remarkPlugins={[remarkGfm]}
      components={
        inline
          ? {
              p: ({ children }) => <>{children}</>,
              ul: ({ children }) => <>{children}</>,
              ol: ({ children }) => <>{children}</>
            }
          : {
              a: ({ href, children }) => (
                <a href={href} rel="noreferrer" target="_blank">
                  {children}
                </a>
              )
            }
      }
    >
      {children}
    </ReactMarkdown>
  );
}

export function QualityBadge({ quality }: { quality: ExtractionQuality }) {
  const className = quality.score >= 0.7 ? 'pill good' : quality.score >= 0.4 ? 'pill warn' : 'pill bad';
  return (
    <span className={className} title={quality.warnings.join('\n')}>
      Quality {Math.round(quality.score * 100)}% · {quality.textLength} chars
    </span>
  );
}

export function SummaryView({ summary, language = 'en' }: { summary: SummaryResult; language?: UiLanguage }) {
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between wrap">
          <span className="eyebrow">{t(language, 'tldr')}</span>
          <span className={`pill ${summary.confidence === 'high' ? 'good' : summary.confidence === 'low' ? 'bad' : 'warn'}`}>
            {t(language, 'confidence')} {summary.confidence}
          </span>
        </div>
        <MarkdownText>{summary.tldr}</MarkdownText>
      </div>

      {summary.bullets.length > 0 && (
        <div className="card stack">
          <h3>{t(language, 'bullets')}</h3>
          <ul className="summary-list">
            {summary.bullets.map((bullet, index) => (
              <li key={`${bullet}-${index}`}><MarkdownText inline>{bullet}</MarkdownText></li>
            ))}
          </ul>
        </div>
      )}

      {summary.detailed && (
        <div className="card stack">
          <h3>{t(language, 'detailedSummary')}</h3>
          <MarkdownText>{summary.detailed}</MarkdownText>
        </div>
      )}

      {summary.keyClaims.length > 0 && (
        <div className="card stack">
          <h3>{t(language, 'claims')}</h3>
          <ul className="summary-list">
            {summary.keyClaims.map((claim, index) => (
              <li key={`${claim}-${index}`}><MarkdownText inline>{claim}</MarkdownText></li>
            ))}
          </ul>
        </div>
      )}

      {summary.quotes.length > 0 && (
        <div className="card stack">
          <h3>{t(language, 'quotedEvidence')}</h3>
          <div className="quote-list">
            {summary.quotes.map((quote, index) => (
              <div className="quote" key={`${quote.text}-${index}`}>
                <MarkdownText>{quote.text}</MarkdownText>
                <div className="muted">{quote.sourceBlockId ? `${quote.sourceBlockId} · ` : ''}<MarkdownText inline>{quote.reason}</MarkdownText></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(summary.entities.length > 0 || summary.topics.length > 0) && (
        <div className="card stack">
          <h3>{t(language, 'memorySeeds')}</h3>
          {summary.topics.length > 0 && <p className="muted">Topics: {summary.topics.join(', ')}</p>}
          {summary.entities.length > 0 && <p className="muted">Entities: {summary.entities.join(', ')}</p>}
        </div>
      )}

      {summary.openQuestions && summary.openQuestions.length > 0 && (
        <div className="card stack">
          <h3>{t(language, 'openQuestions')}</h3>
          <ul className="summary-list">
            {summary.openQuestions.map((question, index) => (
              <li key={`${question}-${index}`}><MarkdownText inline>{question}</MarkdownText></li>
            ))}
          </ul>
        </div>
      )}

      {summary.actionItems && summary.actionItems.length > 0 && (
        <div className="card stack">
          <h3>{t(language, 'actionItems')}</h3>
          <ul className="summary-list">
            {summary.actionItems.map((item, index) => (
              <li key={`${item}-${index}`}><MarkdownText inline>{item}</MarkdownText></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
