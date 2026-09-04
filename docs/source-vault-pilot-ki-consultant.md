# SOURCE VAULT Pilot — KI Consultant Workbooks

Status: prepared pilot manifest
Date: 2026-08-09

This manifest records technical fingerprints and structural expectations for the three original XLSX files selected as the first SOURCE VAULT acceptance set. It intentionally stores metadata only, not workbook content.

## 1. Kundenfeedback Auswertung

- Original upload filename: `Vorlage_Kundenfeedback Auswertung(1).xlsx`
- Expected byte size: `32765`
- SHA-256: `98973fbeb509629826cb3917f5ddcbca300ee1e96ebff23775a7d60da413d436`
- Expected source type: `SPREADSHEET`
- Expected project key: `KI-CONSULTANT`
- Expected domain: `consulting`

Expected sheets:

| Sheet | Dimension observed | Populated cells observed | Formula cells observed |
|---|---:|---:|---:|
| Vorlage | 1000 x 9 max grid | 14 | 5 |
| Beispielfeedback | 52 x 7 max grid | 156 | 0 |

## 2. SheetGPT Prompts & Anwendungsfälle

- Original upload filename: `SheetGPT-Vorlage_Prompts & Anwendungsfälle(1).xlsx`
- Expected byte size: `91352`
- SHA-256: `442cd87bddd147c784c86d241ff33163bd6773011351d14f332a880cfc162a48`
- Expected source type: `SPREADSHEET`
- Expected project key: `KI-CONSULTANT`
- Expected domain: `consulting`

Expected sheets:

| Sheet | Max rows | Max columns | Populated cells | Formula cells |
|---|---:|---:|---:|---:|
| Maßnahmenkatalog | 1000 | 31 | 172 | 18 |
| Content-Creation | 1000 | 50 | 205 | 18 |
| Content-Creation_2.0 | 975 | 51 | 20 | 7 |
| Übersetzung | 30 | 6 | 85 | 81 |

## 3. SheetGPT HR Modul

- Original upload filename: `SheetGPT_HR Modul(1).xlsx`
- Expected byte size: `424987`
- SHA-256: `5e08a6b7d5fcadae468d74f4007e81038c8164960285958c70a0abd024a1be71`
- Expected source type: `SPREADSHEET`
- Expected project key: `KI-CONSULTANT`
- Expected domain: `hr`

Expected sheets:

| Sheet | Max rows | Max columns | Populated cells | Formula cells |
|---|---:|---:|---:|---:|
| Einführung SheetGPT | 21 | 4 | 21 | 0 |
| Performace Rec. Ad | 987 | 26 | 48 | 15 |
| Active Sourcing | 989 | 26 | 49 | 13 |
| Organische SoMe Posts | 957 | 27 | 47 | 14 |
| LinkedIn-Posts | 986 | 27 | 65 | 6 |
| Candidate Experience | 911 | 51 | 33 | 21 |
| Strukturiertes Interview | 967 | 21 | 80 | 39 |
| Arbeitszeugnis | 983 | 26 | 40 | 13 |

## Pilot acceptance sequence

For each workbook:

1. `POST /source-vault/upload`
2. verify returned SHA-256 equals this manifest
3. re-upload exact same file and verify `duplicate=true`
4. retrieve with `GET /source-vault/sources/:id/content`
5. verify response `X-Content-SHA256`
6. run `POST /source-vault/sources/:id/extract/xlsx`
7. verify sheet names and formula counts against this manifest
8. create at least one `KnowledgeSourceLink` with `locatorType=CELL_RANGE`
9. inspect source lineage and audit trail

## Important distinction

The counts above were established from the original workbooks during source analysis. They are pilot assertions, not business knowledge. Workbook content remains in SOURCE VAULT; only validated derived knowledge belongs in AOE Canon.
