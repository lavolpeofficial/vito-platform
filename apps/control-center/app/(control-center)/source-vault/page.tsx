import './source-vault.css';
import { buildApiPath } from '@/lib/api/client';
import { VitoApiError } from '@/lib/api/error';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { parseKnowledgeHits, parseSourceList, type KnowledgeHit, type SourceSummary } from '@/lib/source-vault/contracts';
import { harvestSourceAction, uploadSourceAction } from '@/lib/source-vault/actions';

export const metadata = { title: 'Source Vault' };

type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

const NOTICE_COPY: Readonly<Record<string, string>> = {
  UPLOADED_HARVESTED: 'Source gespeichert und automatisch in Knowledge überführt.',
  DUPLICATE_HARVESTED: 'Exaktes Duplikat erkannt; bestehende Source wurde erneut geprüft und geharvestet.',
  UPLOADED_UNSUPPORTED_FOR_HARVEST: 'Source gespeichert. Für dieses Format ist noch kein Knowledge-Harvester freigeschaltet.',
  UPLOADED_HARVEST_FAILED: 'Source gespeichert, aber der automatische Harvest konnte nicht abgeschlossen werden.',
  HARVESTED: 'Knowledge-Harvest erfolgreich abgeschlossen.',
};

export default async function SourceVaultPage({ searchParams }: Readonly<{ searchParams: PageSearchParams }>) {
  const params = await searchParams;
  const query = first(params.q)?.trim().slice(0, 300) ?? '';
  const notice = first(params.notice);
  const errorCode = first(params.error);
  const units = first(params.units);

  let sources: readonly SourceSummary[] = [];
  let hits: readonly KnowledgeHit[] = [];
  let loadError: string | null = null;

  try {
    const client = await createAuthenticatedVitoApiClient();
    sources = await client.get('/source-vault/sources', parseSourceList);
    if (query) hits = await client.get(buildApiPath('/knowledge/search', { q: query, limit: 10 }), parseKnowledgeHits);
  } catch (error) {
    loadError = error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR';
  }

  return (
    <main>
      <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Source Vault</span></div>
      <section className="module-heading">
        <div className="module-icon">SV</div>
        <div>
          <span className="eyebrow">Knowledge intake</span>
          <h1>Source Vault</h1>
          <p>Originale speichern, Formate serverseitig ableiten, Knowledge harvesten und jede Aussage auf ihre Source-Provenienz zurückführen.</p>
        </div>
      </section>

      <div className="boundary-notice">
        <span className="system-dot" />
        <div><strong>Governed intake</strong><p>Uploads werden tenant-gebunden gespeichert und gehasht. Der Browser wählt keinen Harvester; VITO dispatcht anhand persistierter Source-Metadaten.</p></div>
      </div>

      {notice && NOTICE_COPY[notice] ? <div className="vault-banner vault-banner-success">{NOTICE_COPY[notice]}{units ? ` ${units} Knowledge Units.` : ''}</div> : null}
      {errorCode ? <div className="vault-banner vault-banner-error">Aktion fehlgeschlagen: {errorCode}</div> : null}
      {loadError ? <div className="vault-banner vault-banner-error">SOURCE VAULT konnte nicht geladen werden: {loadError}</div> : null}

      <section className="vault-grid">
        <div className="vault-panel">
          <span className="eyebrow">01 · Intake</span>
          <h2>Source hinzufügen</h2>
          <p className="vault-muted">PDF, DOCX, XLSX, PPTX und textbasierte Formate werden nach dem Upload automatisch klassifiziert und – sofern unterstützt – direkt geharvestet.</p>
          <form action={uploadSourceAction} className="vault-form">
            <label>Datei<input type="file" name="file" required /></label>
            <div className="vault-form-row">
              <label>Titel<input name="title" maxLength={500} placeholder="Optional" /></label>
              <label>Projekt<input name="projectKey" maxLength={200} placeholder="Optional" /></label>
            </div>
            <div className="vault-form-row">
              <label>Domain<input name="domain" maxLength={200} placeholder="Optional" /></label>
              <label>Sprache<input name="language" maxLength={32} placeholder="de / it / en" /></label>
            </div>
            <button className="primary-button" type="submit">Speichern + Harvest</button>
          </form>
        </div>

        <div className="vault-panel">
          <span className="eyebrow">02 · Retrieval</span>
          <h2>Knowledge durchsuchen</h2>
          <p className="vault-muted">PostgreSQL Full-Text Retrieval über bereits geharvestete Knowledge Units – inklusive Source- und Locator-Provenienz.</p>
          <form method="get" className="vault-search-form">
            <input name="q" defaultValue={query} maxLength={300} placeholder="z. B. Pflegegrad, Prozess, Vertrag …" />
            <button type="submit">Suchen</button>
          </form>
          {query ? <KnowledgeResults query={query} hits={hits} /> : <p className="vault-empty-copy">Suchbegriff eingeben, um belegte Knowledge-Fragmente zu finden.</p>}
        </div>
      </section>

      <section className="vault-sources">
        <div className="vault-section-head">
          <div><span className="eyebrow">03 · Registry</span><h2>Sources</h2></div>
          <span className="status-chip">{sources.length} registered</span>
        </div>
        {sources.length === 0 ? <div className="empty-state"><h2>Noch keine Sources</h2><p>Der Vault ist leer oder aktuell nicht abrufbar.</p></div> : (
          <div className="vault-source-list">
            {sources.map((source) => <SourceRow key={source.id} source={source} />)}
          </div>
        )}
      </section>
    </main>
  );
}

function SourceRow({ source }: Readonly<{ source: SourceSummary }>) {
  return (
    <article className="vault-source-row">
      <div className="vault-source-main">
        <div className="vault-source-title"><strong>{source.title ?? source.originalFilename}</strong><span>{source.sourceId}</span></div>
        <div className="vault-source-meta">
          <span>{source.sourceType}</span><span>{source.mimeType}</span><span>v{source.version}</span><span>{formatBytes(source.byteSize)}</span>
        </div>
      </div>
      <div className="vault-statuses">
        <Status label="ingestion" value={source.ingestionStatus} />
        <Status label="extraction" value={source.extractionStatus} />
        <Status label="validation" value={source.validationStatus} />
      </div>
      <div className="vault-source-actions">
        <span>{new Date(source.ingestedAt).toLocaleString('de-DE')}</span>
        <form action={harvestSourceAction}>
          <input type="hidden" name="sourceId" value={source.id} />
          <button type="submit" className="vault-secondary-button">Harvest</button>
        </form>
      </div>
    </article>
  );
}

function KnowledgeResults({ query, hits }: Readonly<{ query: string; hits: readonly KnowledgeHit[] }>) {
  if (hits.length === 0) return <p className="vault-empty-copy">Keine Knowledge Units für „{query}“ gefunden.</p>;
  return (
    <div className="vault-hit-list">
      {hits.map((hit) => (
        <article key={hit.id} className="vault-hit">
          <div className="vault-hit-meta"><strong>{hit.sourcePublicId}</strong><span>{hit.locatorType ?? 'SOURCE'} · {hit.locatorValue ?? 'n/a'}</span></div>
          <p>{hit.content}</p>
          <small>{hit.derivationType} · rank {hit.rank.toFixed(3)}</small>
        </article>
      ))}
    </div>
  );
}

function Status({ label, value }: Readonly<{ label: string; value: string }>) {
  return <span className="vault-status"><small>{label}</small><strong>{value}</strong></span>;
}

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
