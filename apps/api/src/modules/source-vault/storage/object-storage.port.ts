export interface PutObjectInput {
  organizationId: string;
  sourceId: string;
  filename: string;
  mimeType: string;
  body: Buffer;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  storageUri: string;
  byteSize: number;
  etag?: string;
}

/**
 * Provider-agnostischer Storage-Port für SOURCE VAULT.
 *
 * Der Core darf weder AWS, Hetzner, MinIO noch einen anderen Anbieter
 * direkt kennen. Ein Adapter implementiert diesen Vertrag und kann später
 * ausgetauscht werden, ohne Provenance- oder Domainlogik zu verändern.
 */
export abstract class ObjectStoragePort {
  abstract putImmutable(input: PutObjectInput): Promise<StoredObject>;
  abstract exists(storageUri: string): Promise<boolean>;
  abstract get(storageUri: string): Promise<Buffer>;
  abstract delete(storageUri: string): Promise<void>;
}
