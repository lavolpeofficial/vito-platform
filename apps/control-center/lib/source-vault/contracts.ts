export type SourceType = 'DOCUMENT' | 'SPREADSHEET' | 'PRESENTATION' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'EMAIL' | 'WEB_CAPTURE' | 'DATASET' | 'OTHER';

export type SourceSummary = Readonly<{
  id: string;
  sourceId: string;
  sourceType: SourceType;
  originalFilename: string;
  mimeType: string;
  byteSize: string;
  version: number;
  ingestionStatus: string;
  extractionStatus: string;
  validationStatus: string;
  ingestedAt: string;
  title: string | null;
  projectKey: string | null;
  domain: string | null;
  knowledgeLinkCount: number;
}>;

export type SourceUploadResult = Readonly<{ duplicate: boolean; source: SourceSummary }>;
export type HarvestResult = Readonly<{ sourceId: string; knowledgeUnits: number; unitType: 'TEXT_FRAGMENT'; semanticEnrichment: false }>;
export type KnowledgeHit = Readonly<{
  id: string;
  sourceId: string;
  sourcePublicId: string;
  unitType: string;
  content: string;
  locatorType: string | null;
  locatorValue: string | null;
  derivationType: string;
  confidence: number | null;
  rank: number;
}>;

const SOURCE_TYPES = new Set<SourceType>(['DOCUMENT', 'SPREADSHEET', 'PRESENTATION', 'IMAGE', 'AUDIO', 'VIDEO', 'EMAIL', 'WEB_CAPTURE', 'DATASET', 'OTHER']);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function inferSourceType(filename: string, mimeType: string): SourceType {
  const name = filename.trim().toLowerCase();
  const mime = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (mime === XLSX_MIME || name.endsWith('.xlsx')) return 'SPREADSHEET';
  if (mime === PPTX_MIME || name.endsWith('.pptx')) return 'PRESENTATION';
  if (mime === DOCX_MIME || mime === 'application/pdf' || name.endsWith('.docx') || name.endsWith('.pdf')) return 'DOCUMENT';
  if (mime === 'message/rfc822' || name.endsWith('.eml')) return 'EMAIL';
  if (mime === 'text/html' || mime === 'application/xhtml+xml' || name.endsWith('.html') || name.endsWith('.htm')) return 'WEB_CAPTURE';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime === 'text/csv' || mime === 'application/vnd.ms-excel' || name.endsWith('.csv')) return 'DATASET';
  if (mime.startsWith('text/') || ['application/json', 'application/ld+json', 'application/xml'].includes(mime) || /\.(txt|md|json|xml)$/i.test(name)) return 'DOCUMENT';
  return 'OTHER';
}

export function parseSourceList(input: unknown): readonly SourceSummary[] | null {
  if (!Array.isArray(input) || input.length > 1000) return null;
  const result: SourceSummary[] = [];
  for (const item of input) {
    const source = parseSource(item);
    if (!source) return null;
    result.push(source);
  }
  return result;
}

export function parseSourceUpload(input: unknown): SourceUploadResult | null {
  const root = asRecord(input);
  if (!root || typeof root.duplicate !== 'boolean') return null;
  const source = parseSource(root.source);
  return source ? { duplicate: root.duplicate, source } : null;
}

export function parseHarvestResult(input: unknown): HarvestResult | null {
  const root = asRecord(input);
  if (!root || !isString(root.sourceId, 256) || !isNonNegativeInteger(root.knowledgeUnits) || root.unitType !== 'TEXT_FRAGMENT' || root.semanticEnrichment !== false) return null;
  return { sourceId: root.sourceId, knowledgeUnits: root.knowledgeUnits, unitType: 'TEXT_FRAGMENT', semanticEnrichment: false };
}

export function parseKnowledgeHits(input: unknown): readonly KnowledgeHit[] | null {
  if (!Array.isArray(input) || input.length > 20) return null;
  const result: KnowledgeHit[] = [];
  for (const item of input) {
    const row = asRecord(item);
    if (!row || !isString(row.id, 256) || !isString(row.sourceId, 256) || !isString(row.sourcePublicId, 256) || !isString(row.unitType, 128) || !isString(row.content, 5000) || !isNullableString(row.locatorType, 128) || !isNullableString(row.locatorValue, 512) || !isString(row.derivationType, 128) || !(row.confidence === null || isFiniteNumber(row.confidence)) || !isFiniteNumber(row.rank)) return null;
    result.push({ id: row.id, sourceId: row.sourceId, sourcePublicId: row.sourcePublicId, unitType: row.unitType, content: row.content, locatorType: row.locatorType, locatorValue: row.locatorValue, derivationType: row.derivationType, confidence: row.confidence, rank: row.rank });
  }
  return result;
}

function parseSource(value: unknown): SourceSummary | null {
  const row = asRecord(value);
  if (!row || !isString(row.id, 256) || !isString(row.sourceId, 256) || !isString(row.sourceType, 64) || !SOURCE_TYPES.has(row.sourceType as SourceType) || !isString(row.originalFilename, 1024) || !isString(row.mimeType, 512) || !isByteSize(row.byteSize) || !isNonNegativeInteger(row.version) || !isString(row.ingestionStatus, 64) || !isString(row.extractionStatus, 64) || !isString(row.validationStatus, 64) || !isDate(row.ingestedAt) || !isNullableString(row.title, 1024) || !isNullableString(row.projectKey, 512) || !isNullableString(row.domain, 512)) return null;
  const links = row.knowledgeLinks;
  if (links !== undefined && (!Array.isArray(links) || links.length > 10000)) return null;
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceType: row.sourceType as SourceType,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: String(row.byteSize),
    version: row.version,
    ingestionStatus: row.ingestionStatus,
    extractionStatus: row.extractionStatus,
    validationStatus: row.validationStatus,
    ingestedAt: row.ingestedAt,
    title: row.title,
    projectKey: row.projectKey,
    domain: row.domain,
    knowledgeLinkCount: Array.isArray(links) ? links.length : 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function isString(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function isNullableString(value: unknown, max: number): value is string | null { return value === null || value === undefined || isString(value, max); }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isDate(value: unknown): value is string { return isString(value, 128) && !Number.isNaN(Date.parse(value)); }
function isByteSize(value: unknown): value is string | number { return (typeof value === 'string' && /^\d+$/.test(value)) || isNonNegativeInteger(value); }
