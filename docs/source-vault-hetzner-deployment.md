# SOURCE VAULT — Hetzner Object Storage Deployment

Status: operational runbook

## Recommended production target

Hetzner Object Storage is S3-compatible and available in European locations. For LA VOLPE, use a **private** bucket. The VITO core remains provider-neutral.

Suggested initial location: `nbg1` (Nuremberg). If deployment latency or infrastructure location later suggests otherwise, switch provider/location without changing Source Vault domain logic.

Hetzner endpoints:

- Nuremberg: `https://nbg1.your-objectstorage.com`
- Falkenstein: `https://fsn1.your-objectstorage.com`
- Helsinki: `https://hel1.your-objectstorage.com`

## 1. Create bucket in Hetzner Console

Inside the intended Hetzner project:

1. Open **Object Storage**.
2. Create a bucket.
3. Choose `nbg1` initially.
4. Suggested globally unique name: `lavolpe-source-vault-prod-<suffix>`.
5. Visibility: **Private**.

Do not make source originals public.

## 2. Generate S3 credentials

Hetzner Console:

`Security -> S3 Credentials -> Generate credentials`

Suggested description:

`VITO SOURCE VAULT production`

Copy both values immediately. Hetzner does not display the secret key again after closing the credential dialog.

Never commit either credential to Git.

## 3. Production environment

Set in the deployment secret manager / protected environment only:

```env
SOURCE_VAULT_STORAGE_DRIVER=s3
SOURCE_VAULT_S3_ENDPOINT=https://nbg1.your-objectstorage.com
SOURCE_VAULT_S3_REGION=nbg1
SOURCE_VAULT_S3_BUCKET=<private-bucket-name>
SOURCE_VAULT_S3_ACCESS_KEY_ID=<secret>
SOURCE_VAULT_S3_SECRET_ACCESS_KEY=<secret>
SOURCE_VAULT_MAX_UPLOAD_BYTES=26214400
```

`NODE_ENV=production` intentionally rejects local Source Vault storage. Production must explicitly use the S3 driver.

## 4. Database migration

Before enabling uploads:

```bash
pnpm prisma:migrate:deploy
pnpm prisma:generate
```

Then deploy/start VITO.

## 5. Pilot workflow

Run the three KI Consultant workbooks through the API in this order:

1. `Vorlage_Kundenfeedback Auswertung.xlsx`
2. `SheetGPT-Vorlage_Prompts & Anwendungsfälle.xlsx`
3. `SheetGPT_HR Modul.xlsx`

For each workbook verify:

1. Upload succeeds.
2. Returned SHA-256 equals local SHA-256.
3. Re-upload returns an exact duplicate instead of storing another binary.
4. Original can be downloaded.
5. Downloaded SHA-256 matches the registered SHA-256.
6. XLSX extraction succeeds.
7. Sheet/formula structure matches the pilot manifest in `docs/source-vault-pilot-ki-consultant.md`.
8. Source remains tenant-scoped.
9. Audit entries exist.

## 6. Security invariants

- bucket private
- no secrets in Git, Logseq, screenshots, chat exports or source metadata
- no public object URLs
- tenant boundary enforced in VITO, not inferred from object key alone
- SHA-256 verified before extraction and on original retrieval
- originals treated as immutable
- changed files become new Source versions; never overwrite provenance

## 7. Optional later hardening

Not required for v0.1 acceptance:

- restricted S3 bucket policy per dedicated access key
- object lock / retention policy for selected evidence classes
- malware scanning quarantine
- PII classification
- lifecycle/cold-storage rules
- independent backup of critical source metadata

## Exit criterion

SOURCE VAULT v0.1 is operationally complete once all three KI Consultant XLSX files pass the end-to-end pilot against the private Hetzner bucket.