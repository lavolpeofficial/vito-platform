import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  decodeOpenXml,
  openXmlAttr,
  openXmlTextEntry,
  readOpenXmlZipEntries,
  unzipOpenXmlEntry,
  type OpenXmlZipEntry,
} from './openxml-zip';

const MAX_SHEETS = 128;
const MAX_ROWS = 5_000;
const MAX_CELLS = 20_000;
const MAX_CELL_CHARS = 4_000;
const MAX_ROW_CHARS = 12_000;
const MAX_TOTAL_CHARS = 524_288;

export interface XlsxKnowledgeRow {
  readonly sheetName: string;
  readonly rowNumber: number;
  readonly cellRange: string;
  readonly text: string;
}

export interface XlsxKnowledgeEnvelope {
  readonly format: 'xlsx';
  readonly adapter: 'vito-openxml-lite';
  readonly adapterVersion: '0.2.0';
  readonly rows: readonly XlsxKnowledgeRow[];
  readonly totals: Readonly<{
    sheets: number;
    rows: number;
    cells: number;
    characters: number;
  }>;
}

export function extractXlsxKnowledgeRows(buffer: Buffer): XlsxKnowledgeEnvelope {
  const entries = readOpenXmlZipEntries(buffer);
  const workbook = openXmlTextEntry(buffer, entries, 'xl/workbook.xml');
  const relationships = openXmlTextEntry(buffer, entries, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = readSharedStrings(buffer, entries);
  const relationshipTargets = readRelationshipTargets(relationships);
  const rows: XlsxKnowledgeRow[] = [];
  let sheetCount = 0;
  let cellCount = 0;
  let characterCount = 0;

  for (const sheetMatch of workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)) {
    const sheetName = openXmlAttr(sheetMatch[0], 'name');
    const relationshipId = openXmlAttr(sheetMatch[0], 'r:id');
    if (!sheetName || !relationshipId) continue;
    const path = relationshipTargets.get(relationshipId);
    if (!path) continue;
    sheetCount += 1;
    if (sheetCount > MAX_SHEETS) {
      throw new PayloadTooLargeException(`XLSX exceeds ${MAX_SHEETS} sheets for knowledge extraction.`);
    }

    const sheetXml = openXmlTextEntry(buffer, entries, path);
    let fallbackRowNumber = 0;
    for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>(.*?)<\/row>/gs)) {
      fallbackRowNumber += 1;
      const rowNumber = Number(openXmlAttr(rowMatch[1], 'r') ?? fallbackRowNumber);
      const cells = readRowCells(rowMatch[2], sharedStrings);
      if (cells.length === 0) continue;
      if (rows.length >= MAX_ROWS) {
        throw new PayloadTooLargeException(`XLSX exceeds ${MAX_ROWS} non-empty rows for knowledge extraction.`);
      }
      cellCount += cells.length;
      if (cellCount > MAX_CELLS) {
        throw new PayloadTooLargeException(`XLSX exceeds ${MAX_CELLS} non-empty cells for knowledge extraction.`);
      }

      const text = `Sheet ${JSON.stringify(sheetName)} row ${rowNumber}: ${cells.map((cell) => cell.rendered).join(' | ')}`;
      if (text.length > MAX_ROW_CHARS) {
        throw new PayloadTooLargeException(`XLSX row exceeds ${MAX_ROW_CHARS} extracted characters.`);
      }
      characterCount += text.length;
      if (characterCount > MAX_TOTAL_CHARS) {
        throw new PayloadTooLargeException(`XLSX extracted text exceeds ${MAX_TOTAL_CHARS} characters.`);
      }
      const firstRef = cells[0].ref;
      const lastRef = cells[cells.length - 1].ref;
      rows.push(Object.freeze({
        sheetName,
        rowNumber,
        cellRange: firstRef === lastRef ? `${sheetName}!${firstRef}` : `${sheetName}!${firstRef}:${lastRef}`,
        text,
      }));
    }
  }

  if (rows.length === 0) {
    throw new BadRequestException('XLSX contains no harvestable cell values.');
  }

  return Object.freeze({
    format: 'xlsx',
    adapter: 'vito-openxml-lite',
    adapterVersion: '0.2.0',
    rows: Object.freeze(rows),
    totals: Object.freeze({
      sheets: sheetCount,
      rows: rows.length,
      cells: cellCount,
      characters: characterCount,
    }),
  });
}

function readRelationshipTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const id = openXmlAttr(match[0], 'Id');
    const target = openXmlAttr(match[0], 'Target');
    if (!id || !target) continue;
    const cleaned = target.replace(/^\//, '');
    targets.set(id, cleaned.startsWith('xl/') ? cleaned : `xl/${cleaned.replace(/^\.\//, '')}`);
  }
  return targets;
}

function readSharedStrings(buffer: Buffer, entries: Map<string, OpenXmlZipEntry>): string[] {
  const entry = entries.get('xl/sharedStrings.xml');
  if (!entry) return [];
  const xml = unzipOpenXmlEntry(buffer, entry).toString('utf8');
  const values: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>(.*?)<\/si>/gs)) {
    let value = '';
    for (const text of match[1].matchAll(/<t\b[^>]*>(.*?)<\/t>/gs)) value += decodeOpenXml(text[1]);
    values.push(value.slice(0, MAX_CELL_CHARS));
  }
  return values;
}

function readRowCells(xml: string, sharedStrings: string[]): Array<{ ref: string; rendered: string }> {
  const cells: Array<{ ref: string; rendered: string }> = [];
  for (const cellMatch of xml.matchAll(/<c\b([^>]*)>(.*?)<\/c>/gs)) {
    const ref = openXmlAttr(cellMatch[1], 'r');
    if (!ref) continue;
    const type = openXmlAttr(cellMatch[1], 't');
    const inner = cellMatch[2];
    const formulaMatch = /<f\b[^>]*>(.*?)<\/f>/s.exec(inner);
    const formula = formulaMatch ? decodeOpenXml(formulaMatch[1]).trim().slice(0, MAX_CELL_CHARS) : null;
    const value = readCellValue(type, inner, sharedStrings).slice(0, MAX_CELL_CHARS);
    if (!formula && !value) continue;

    const rendered = formula
      ? `${ref}[formula=${JSON.stringify(formula)}${value ? `, cached=${JSON.stringify(value)}` : ''}]`
      : `${ref}=${JSON.stringify(value)}`;
    cells.push({ ref, rendered });
  }
  return cells;
}

function readCellValue(type: string | undefined, inner: string, sharedStrings: string[]): string {
  if (type === 'inlineStr') {
    let value = '';
    for (const text of inner.matchAll(/<t\b[^>]*>(.*?)<\/t>/gs)) value += decodeOpenXml(text[1]);
    return value.trim();
  }
  const raw = /<v>(.*?)<\/v>/s.exec(inner)?.[1];
  if (raw === undefined) return '';
  const decoded = decodeOpenXml(raw).trim();
  if (type === 's') {
    const index = Number.parseInt(decoded, 10);
    return Number.isInteger(index) && index >= 0 ? (sharedStrings[index] ?? '') : '';
  }
  if (type === 'b') return decoded === '1' ? 'TRUE' : decoded === '0' ? 'FALSE' : decoded;
  return decoded;
}
