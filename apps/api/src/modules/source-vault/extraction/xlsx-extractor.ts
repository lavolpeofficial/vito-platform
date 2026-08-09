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
  totals: {
    sheets: number;
    cells: number;
    formulas: number;
  };
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
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
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
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new BadRequestException(`Ungültiger Local-Header für ${entry.name}.`);
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

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

export function extractXlsxStructure(buffer: Buffer): XlsxExtractionEnvelope {
  const entries = readZipEntries(buffer);
  const workbook = textEntry(buffer, entries, 'xl/workbook.xml');
  const rels = textEntry(buffer, entries, 'xl/_rels/workbook.xml.rels');

  const relationshipTargets = new Map<string, string>();
  const relRegex = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?\s*>/g;
  for (const match of rels.matchAll(relRegex)) {
    relationshipTargets.set(decodeXml(match[1]), normalizeTarget(decodeXml(match[2])));
  }

  const sheets: XlsxSheetSummary[] = [];
  const sheetRegex = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g;
  for (const match of workbook.matchAll(sheetRegex)) {
    const name = decodeXml(match[1]);
    const relationshipId = decodeXml(match[2]);
    const path = relationshipTargets.get(relationshipId);
    if (!path) continue;

    const xml = textEntry(buffer, entries, path);
    const dimension = /<dimension\b[^>]*\bref="([^"]+)"/.exec(xml)?.[1];
    const cellMatches = [...xml.matchAll(/<c\b[^>]*\br="([A-Z]+[0-9]+)"[^>]*>([\s\S]*?)<\/c>/g)];
    const formulaCells: string[] = [];

    for (const cell of cellMatches) {
      if (/<f(?:\s[^>]*)?>[\s\S]*?<\/f>/.test(cell[2]) || /<f\s*\/>/.test(cell[2])) {
        formulaCells.push(cell[1]);
      }
    }

    sheets.push({
      name,
      path,
      dimension,
      cellCount: cellMatches.length,
      formulaCount: formulaCells.length,
      formulaCells,
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
    },
  };
}
