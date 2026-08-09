# SOURCE VAULT v0.1 — VITO implementation

Status: implementation branch `feat/source-vault-v0.1`

## Implemented in this branch

- Prisma enums and `Source` model
- tenant-scoped exact duplicate detection by SHA-256
- immutable version lineage via `supersedesSourceId`
- parent/child source lineage
- generic `KnowledgeSourceLink` bridge using `knowledgeRef`
- page/sheet/cell-range/slide/timecode/etc. provenance locators
- derivation distinction: quote, paraphrase, extraction, inference, synthesis
- REST endpoints for registration, listing, lookup, duplicate checks, lineage and knowledge links
- AuditEvents for source registration and provenance links
- provider-neutral object-storage port
- SHA-256 helper + unit test
- generic S3 configuration placeholders
- Prisma migration

## Deliberately not implemented yet

### Binary upload endpoint
The API currently registers a source **after** an immutable object has been stored. This keeps the first implementation dependency-free and allows the storage provider to remain replaceable.

### S3 adapter
`ObjectStoragePort` is the stable contract. A concrete adapter should be added only after choosing/deploying the S3-compatible provider. The domain layer must not import provider SDK types.

### XLSX extraction adapter
The first extraction adapter should target the three KI-Consultant workbooks. It should preserve workbook/sheet/cell/formula locators and emit a normalized extraction envelope. This comes after durable binary storage is proven.

### Automatic knowledge creation
SOURCE VAULT stores evidence and lineage. It must not silently promote extracted material into Canon. AOE validation/governance remains a separate step.

## Current API surface

- `POST /source-vault/sources`
- `GET /source-vault/sources`
- `GET /source-vault/sources/:id`
- `GET /source-vault/sources/:id/lineage`
- `GET /source-vault/duplicates/:sha256`
- `POST /source-vault/sources/:id/knowledge-links`

Writes require OWNER or ADMIN. Reads remain authenticated and tenant-scoped by the existing global auth/tenant architecture.

## Storage path convention

Recommended adapter convention:

```text
raw/{organizationId}/{sourceId}/{sanitizedOriginalFilename}
```

The stored object is immutable. A changed source is stored under a new Source ID/version rather than overwriting the old object.

## Pilot acceptance path

1. Store `Kundenfeedback Auswertung.xlsx` as an immutable object.
2. Calculate SHA-256.
3. Register metadata and receive Source ID.
4. Re-submit same SHA-256 and verify duplicate detection.
5. Store a modified workbook and register with `supersedesSourceId`.
6. Retrieve lineage.
7. Extract an exact sheet/cell range.
8. Link the resulting knowledge item using `CELL_RANGE`.
9. Resolve the knowledge item back to the original Source/version.
10. Confirm audit events and tenant isolation.

## Safety invariants

- No cross-tenant Source lookup.
- No overwrite of raw originals.
- No external-model processing merely because a Source exists.
- Rights/confidentiality status must travel with the Source.
- `INFERENCE` and `SYNTHESIS` provenance must never masquerade as direct source statements.
- Object-storage credentials are deployment secrets, never repository content.
