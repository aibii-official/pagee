import { useEffect, useState } from 'react';
import { RuntimeMessage, sendRuntimeMessage } from '../../shared/messages';
import type { LibraryEntry } from '../../shared/types';
import { SummaryView } from '../components/SummaryView';
import { formatDate } from '../utils';

export function KnowledgeApp() {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string>();
  const [error, setError] = useState<string>();

  async function load(search = query) {
    setError(undefined);
    try {
      setEntries(await sendRuntimeMessage({ type: RuntimeMessage.ListLibrary, query: search }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load('');
  }, []);

  return (
    <main className="app page stack">
      <section className="hero">
        <span className="eyebrow">Knowledge Hub</span>
        <h1>Local summaries and searchable memory.</h1>
        <p className="muted">Search titles, topics, entities, and generated summaries stored in this browser.</p>
      </section>

      <section className="card stack">
        <div className="row wrap">
          <input
            placeholder="Search local knowledge..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load();
            }}
          />
          <button onClick={() => void load()}>Search</button>
          <button
            className="ghost"
            onClick={() =>
              void sendRuntimeMessage({ type: RuntimeMessage.ClearLibrary }).then(() => {
                setEntries([]);
              })
            }
          >
            Clear
          </button>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="card stack">
        <div className="row between wrap">
          <h2>Saved Items</h2>
          <span className="pill">{entries.length} items</span>
        </div>

        {entries.length === 0 && <p className="muted">No local memories yet. Summarize a page from the side panel or popup.</p>}

        {entries.map((entry) => (
          <article className="list-item" key={entry.document.id}>
            <div className="row between wrap">
              <div className="stack">
                <h3>{entry.document.title}</h3>
                <p className="muted">{entry.document.url}</p>
                <p className="muted">Updated {formatDate(entry.document.updatedAt)} · {entry.document.contentType}</p>
              </div>
              <button className="secondary" onClick={() => setExpandedId(expandedId === entry.document.id ? undefined : entry.document.id)}>
                {expandedId === entry.document.id ? 'Collapse' : 'Open'}
              </button>
            </div>
            {entry.latestSummary && <p>{entry.latestSummary.summary.tldr}</p>}
            {entry.document.topics.length > 0 && <p className="muted">Topics: {entry.document.topics.join(', ')}</p>}
            {expandedId === entry.document.id && entry.latestSummary && <SummaryView summary={entry.latestSummary.summary} />}
          </article>
        ))}
      </section>
    </main>
  );
}
