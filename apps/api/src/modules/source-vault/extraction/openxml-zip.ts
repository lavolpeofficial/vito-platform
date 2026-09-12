import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';

const MAX_ZIP_ENTRIES = 2_048;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

export interface OpenXmlZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

export function decodeOpenXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function openXmlAttr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]+)"`).exec(tag);
  return match ? decodeOpenXml(match[1]) : undefined;
}

export function readOpenXmlZipEntries(buffer: Buffer): Map<string, OpenXmlZipEntry> {
  const eocd = findEocd(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new PayloadTooLargeException(`OpenXML archive exceeds ${MAX_ZIP_ENTRIES} entries.`);
  }
  if (centralOffset >= buffer.length) {
    throw new BadRequestException('Invalid OpenXML archive: central directory offset is out of bounds.');
  }

  const entries = new Map<string, OpenXmlZipEntry>();
  let cursor = centralOffset;
  let totalUncompressedBytes = 0;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new BadRequestException('Invalid OpenXML archive: corrupt central-directory entry.');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const end = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (end > buffer.length) {
      throw new BadRequestException('Invalid OpenXML archive: truncated central directory.');
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new PayloadTooLargeException(`OpenXML entry exceeds ${MAX_ENTRY_BYTES} bytes.`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new PayloadTooLargeException(`OpenXML archive exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} uncompressed bytes.`);
    }
    const name = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    if (!name || name.includes('..') || name.startsWith('/') || name.includes('\\')) {
      throw new BadRequestException('Invalid OpenXML archive entry path.');
    }
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    cursor = end;
  }
  return entries;
}

export function unzipOpenXmlEntry(buffer: Buffer, entry: OpenXmlZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new BadRequestException(`Invalid local header for OpenXML entry ${entry.name}.`);
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new BadRequestException(`OpenXML entry ${entry.name} is truncated.`);
  }
  const compressed = buffer.subarray(dataStart, dataEnd);
  let result: Buffer;
  if (entry.method === 0) {
    result = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      result = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch (error) {
      if (error instanceof RangeError || (error instanceof Error && error.message.includes('larger than maxOutputLength'))) {
        throw new PayloadTooLargeException(`OpenXML entry ${entry.name} exceeds the extraction limit.`);
      }
      throw new BadRequestException(`OpenXML entry ${entry.name} could not be decompressed.`);
    }
  } else {
    throw new BadRequestException(`Unsupported OpenXML ZIP compression method ${entry.method} in ${entry.name}.`);
  }
  if (result.length > MAX_ENTRY_BYTES || (entry.uncompressedSize !== 0 && result.length !== entry.uncompressedSize)) {
    throw new BadRequestException(`OpenXML entry ${entry.name} has inconsistent size metadata.`);
  }
  return result;
}

export function openXmlTextEntry(
  buffer: Buffer,
  entries: Map<string, OpenXmlZipEntry>,
  path: string,
): string {
  const entry = entries.get(path);
  if (!entry) throw new BadRequestException(`OpenXML structure is incomplete: ${path} is missing.`);
  return unzipOpenXmlEntry(buffer, entry).toString('utf8');
}

function findEocd(buffer: Buffer): number {
  if (buffer.length < 22) throw new BadRequestException('Invalid OpenXML archive.');
  const min = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new BadRequestException('Invalid OpenXML archive: end-of-central-directory not found.');
}
