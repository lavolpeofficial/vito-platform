import { Injectable } from '@nestjs/common';
import { access, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, normalize, resolve, sep } from 'path';
import { ObjectStoragePort, PutObjectInput, StoredObject } from './object-storage.port';

@Injectable()
export class LocalObjectStorageAdapter implements ObjectStoragePort {
  private readonly rootDir = resolve(process.env.SOURCE_VAULT_LOCAL_DIR ?? '.source-vault');

  private sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 240) || 'unnamed';
  }

  private toRelativePath(input: PutObjectInput): string {
    return join(
      'raw',
      this.sanitizeSegment(input.organizationId),
      this.sanitizeSegment(input.sourceId),
      this.sanitizeSegment(input.filename),
    );
  }

  private uriFor(relativePath: string): string {
    return `local://${relativePath.split(sep).join('/')}`;
  }

  private pathFromUri(storageUri: string): string {
    if (!storageUri.startsWith('local://')) {
      throw new Error('LocalObjectStorageAdapter kann nur local:// URIs lesen.');
    }

    const relative = normalize(storageUri.slice('local://'.length));
    const absolute = resolve(this.rootDir, relative);
    const rootWithSep = this.rootDir.endsWith(sep) ? this.rootDir : `${this.rootDir}${sep}`;

    if (absolute !== this.rootDir && !absolute.startsWith(rootWithSep)) {
      throw new Error('Ungültige Storage-URI außerhalb des SOURCE VAULT Root-Verzeichnisses.');
    }

    return absolute;
  }

  async putImmutable(input: PutObjectInput): Promise<StoredObject> {
    const relativePath = this.toRelativePath(input);
    const absolutePath = resolve(this.rootDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });

    // wx garantiert: niemals still überschreiben. Immutable RAW bedeutet
    // vorhandene Objekte sind ein Fehler und müssen über Versionierung laufen.
    await writeFile(absolutePath, input.body, { flag: 'wx' });

    return {
      storageUri: this.uriFor(relativePath),
      byteSize: input.body.byteLength,
    };
  }

  async exists(storageUri: string): Promise<boolean> {
    try {
      await access(this.pathFromUri(storageUri));
      return true;
    } catch {
      return false;
    }
  }

  async get(storageUri: string): Promise<Buffer> {
    return readFile(this.pathFromUri(storageUri));
  }

  async delete(storageUri: string): Promise<void> {
    try {
      await unlink(this.pathFromUri(storageUri));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }
}
