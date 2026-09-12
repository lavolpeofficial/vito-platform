import {
  decodeOpenXml,
  openXmlAttr,
  openXmlTextEntry,
  readOpenXmlZipEntries,
  unzipOpenXmlEntry,
  type OpenXmlZipEntry,
} from './openxml-zip';

export interface XlsxSheetSummary {
  name: string;
  path: string;
  dimension?: string;
  cellCount: number;
  formulaCount: number;
  nativeFormulaCount: number;
  formulaLikeStringCount: number;
  formulaCells: string[];
}

export interface XlsxExtractionEnvelope {
  format: 'xlsx';
  adapter: 'vito-openxml-lite';
  adapterVersion: '0.1.0';
  sheets: XlsxSheetSummary[];
  totals: {
    sheets: number;
    cells: number;
    formulas: number;
    nativeFormulas: number;
    formulaLikeStrings: number;
  };
}

function normalizeTarget(target: string): string {
  const cleaned = target.replace(/^\//, '');
  if (cleaned.startsWith('xl/')) return cleaned;
  return `xl/${cleaned.replace(/^\.\//, '')}`;
}

function readSharedStrings(buffer: Buffer, entries: Map<string, OpenXmlZipEntry>): string[] {
  const entry = entries.get('xl/sharedStrings.xml');
  if (!entry) return [];
  const xml = unzipOpenXmlEntry(buffer, entry).toString('utf8');
  const result: string[] = [];

  for (const match of xml.matchAll(/<si\b[^>]*>(.*?)<\/si>/gs)) {
    let value = '';
    for (const text of match[1].matchAll(/<t\b[^>]*>(.*?)<\/t>/gs)) value += decodeOpenXml(text[1]);
    result.push(value);
  }
  return result;
}

function scanCells(xml: string, sharedStrings: string[]) {
  let cursor = 0;
  let cellCount = 0;
  let nativeFormulaCount = 0;
  let formulaLikeStringCount = 0;
  const formulaCells: string[] = [];

  while (cursor < xml.length) {
    const start = xml.indexOf('<c ', cursor);
    if (start < 0) break;
    const tagEnd = xml.indexOf('>', start + 3);
    if (tagEnd < 0) break;
    const startTag = xml.slice(start + 2, tagEnd);

    if (xml[tagEnd - 1] === '/') {
      cursor = tagEnd + 1;
      continue;
    }

    const close = xml.indexOf('</c>', tagEnd + 1);
    if (close < 0) break;
    const ref = openXmlAttr(startTag, 'r');
    if (ref) {
      cellCount += 1;
      const inner = xml.slice(tagEnd + 1, close);
      const hasNativeFormula = inner.indexOf('<f') >= 0;
      let hasFormulaLikeString = false;

      if (!hasNativeFormula && openXmlAttr(startTag, 't') === 's') {
        const valueMatch = /<v>(\d+)<\/v>/.exec(inner);
        if (valueMatch) {
          const sharedValue = sharedStrings[Number(valueMatch[1])];
          hasFormulaLikeString = typeof sharedValue === 'string' && sharedValue.trimStart().startsWith('=');
        }
      }

      if (hasNativeFormula) {
        nativeFormulaCount += 1;
        formulaCells.push(ref);
      } else if (hasFormulaLikeString) {
        formulaLikeStringCount += 1;
        formulaCells.push(ref);
      }
    }
    cursor = close + 4;
  }

  return { cellCount, nativeFormulaCount, formulaLikeStringCount, formulaCells };
}

export function extractXlsxStructure(buffer: Buffer): XlsxExtractionEnvelope {
  const entries = readOpenXmlZipEntries(buffer);
  const workbook = openXmlTextEntry(buffer, entries, 'xl/workbook.xml');
  const rels = openXmlTextEntry(buffer, entries, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = readSharedStrings(buffer, entries);

  const relationshipTargets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const id = openXmlAttr(match[0], 'Id');
    const target = openXmlAttr(match[0], 'Target');
    if (id && target) relationshipTargets.set(id, normalizeTarget(target));
  }

  const sheets: XlsxSheetSummary[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)) {
    const name = openXmlAttr(match[0], 'name');
    const relationshipId = openXmlAttr(match[0], 'r:id');
    if (!name || !relationshipId) continue;
    const path = relationshipTargets.get(relationshipId);
    if (!path) continue;

    const xml = openXmlTextEntry(buffer, entries, path);
    const dimensionTag = /<dimension\b[^>]*\/?\s*>/.exec(xml)?.[0];
    const dimension = dimensionTag ? openXmlAttr(dimensionTag, 'ref') : undefined;
    const scanned = scanCells(xml, sharedStrings);
    const formulaCount = scanned.nativeFormulaCount + scanned.formulaLikeStringCount;

    sheets.push({
      name,
      path,
      dimension,
      cellCount: scanned.cellCount,
      formulaCount,
      nativeFormulaCount: scanned.nativeFormulaCount,
      formulaLikeStringCount: scanned.formulaLikeStringCount,
      formulaCells: scanned.formulaCells,
    });
  }

  return {
    format: 'xlsx',
    adapter: 'vito-openxml-lite',
    adapterVersion: '0.1.0',
    sheets,
    totals: {
      sheets: sheets.length,
      cells: sheets.reduce((sum, sheet) => sum + sheet.cellCount, 0),
      formulas: sheets.reduce((sum, sheet) => sum + sheet.formulaCount, 0),
      nativeFormulas: sheets.reduce((sum, sheet) => sum + sheet.nativeFormulaCount, 0),
      formulaLikeStrings: sheets.reduce((sum, sheet) => sum + sheet.formulaLikeStringCount, 0),
    },
  };
}
