export type MemoryKind = 'WORKING' | 'EPISODIC' | 'SEMANTIC' | 'ORGANIZATIONAL';

export interface MemoryRecord {
  id: string;
  organizationId: string;
  kind: MemoryKind;
  subjectId?: string;
  content: Readonly<Record<string, unknown>>;
  provenance?: Readonly<Record<string, unknown>>;
  visibility: 'PRIVATE' | 'WORKFORCE' | 'ORGANIZATION';
  createdAt: Date;
  expiresAt?: Date;
}

export interface StoreMemoryCommand {
  organizationId: string;
  kind: MemoryKind;
  subjectId?: string;
  content: Readonly<Record<string, unknown>>;
  provenance?: Readonly<Record<string, unknown>>;
  visibility: MemoryRecord['visibility'];
  expiresAt?: Date;
}

export interface MemorySearchQuery {
  organizationId: string;
  kinds?: readonly MemoryKind[];
  subjectId?: string;
  text?: string;
  limit: number;
}

/**
 * Tenant-safe persistence port. Implementations must never return records from
 * a different organization, even when the underlying provider is shared.
 */
export interface MemoryStorePort {
  store(command: StoreMemoryCommand): Promise<MemoryRecord>;
  search(query: MemorySearchQuery): Promise<readonly MemoryRecord[]>;
  delete(organizationId: string, memoryId: string): Promise<void>;
}
