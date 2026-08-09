import { BadRequestException } from '@nestjs/common';
import { inflateRawSync } from 'zlib';

export interface XlsxSheetSummary {
  name: string;
  path: string;
  dimension?: string;
  cellCount: number;
  formulaCount: number;
  formulaCells: string[];
}

export interface XlsxExtractionEnvelope {
  format: 'xlsx';
  adapter: 'vito-openxml-lite';
  adapterVersion: '0.1.0';
  sheets: XlsxSheetSummary[];
  totals: { sheets: number; cells: number; formulas: number };
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]+)"`).exec(tag);
  return match ? decodeXml(match[1]) : undefined;
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new BadRequestException('Ungültige XLSX/ZIP-Datei: End-of-central-directory nicht gefunden.');
}

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  const eocd = findEocd(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  let cursor = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new BadRequestException('Ungültige XLSX/ZIP-Datei: Central-directory Eintrag beschädigt.');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function unzipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new BadRequestException(`Ungültiger Local-Header für ${entry.name}.`);
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new BadRequestException(`ZIP-Eintrag ${entry.name} ist abgeschnitten.`);
  const compressed = buffer.subarray(dataStart, dataEnd);

  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new BadRequestException(`Nicht unterstützte ZIP-Kompressionsmethode ${entry.method} in ${entry.name}.`);
}

function textEntry(buffer: Buffer, entries: Map<string, ZipEntry>, path: string): string {
  const entry = entries.get(path);
  if (!entry) throw new BadRequestException(`XLSX-Struktur unvollständig: ${path} fehlt.`);
  return unzipEntry(buffer, entry).toString('utf8');
}

function normalizeTarget(target: string): string {
  const cleaned = target.replace(/^\//, '');
  if (cleaned.startsWith('xl/')) return cleaned;
  return `xl/${cleaned.replace(/^\.\//, '')}`;
}

function scanCells(xml: string): { cellCount: number; formulaCells: string[] } {
  let cursor = 0;
  let cellCount = 0;
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
    const ref = attr(startTag, 'r');
    if (ref) {
      cellCount += 1;
      const inner = xml.slice(tagEnd + 1, close);
      if (inner.indexOf('<f') >= 0) formulaCells.push(ref);
    }
    cursor = close + 4;
  }

  return { cellCount, formulaCells };
}

export function extractXlsxStructure(buffer: Buffer): XlsxExtractionEnvelope {
  const entries = readZipEntries(buffer);
  const workbook = textEntry(buffer, entries, 'xl/workbook.xml');
  const rels = textEntry(buffer, entries, 'xl/_rels/workbook.xml.rels');

  const relationshipTargets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const id = attr(match[0], 'Id');
    const target = attr(match[0], 'Target');
    if (id && target) relationshipTargets.set(id, normalizeTarget(target));
  }

  const sheets: XlsxSheetSummary[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)) {
    const name = attr(match[0], 'name');
    const relationshipId = attr(match[0], 'r:id');
    if (!name || !relationshipId) continue;
    const path = relationshipTargets.get(relationshipId);
    if (!path) continue;

    const xml = textEntry(buffer, entries, path);
    const dimensionTag = /<dimension\b[^>]*\/?\s*>/.exec(xml)?.[0];
    const dimension = dimensionTag ? attr(dimensionTag, 'ref') : undefined;
    const { cellCount, formulaCells } = scanCells(xml);

    sheets.push({ name, path, dimension, cellCount, formulaCount: formulaCells.length, formulaCells });
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
    },
  };
}
