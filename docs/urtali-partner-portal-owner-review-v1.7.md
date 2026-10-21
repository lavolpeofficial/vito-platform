# URTALI Partner Portal — Owner Review V1.7

Status: REVIEW BUILD ONLY
Branch: `feat/urtali-partner-portal-v1`
PR: #166
Merge: NO_GO
Deployment: NO_GO
Production data: NONE

## Review objective

Confirm the visual direction, readability and information hierarchy before any Auth0, API, database or staging integration begins.

## Visual baseline

Approved direction implemented:
- URTALI premium Alpine visual system
- Navy / Gold / Ice palette
- crossbar-less metallic gold A/Λ in URTALI wordmark
- stronger 3D depth
- controlled gloss / reflected light
- premium cool shadows
- gold accents only for priority / brand cues
- readability optimized for 100% browser zoom
- BRIDGE visual language for the partner ecosystem
- URTALI peak language remains the corporate / systems visual world

## Owner review routes

Review at 100% browser zoom:

1. `/`
   - hero clarity and image strength
   - URTALI wordmark and gold A/Λ
   - values panel
   - journey
   - four primary work cards
   - lifecycle
   - role / authorization / portfolio
   - trust & governance

2. `/academy`
   - progress state
   - module hierarchy
   - premium card depth
   - readable metadata

3. `/solutions`
   - product/offer cards
   - price and use-case readability
   - authorization badge hierarchy

4. `/sales`
   - sales asset cards
   - filters
   - content hierarchy

5. `/leads`
   - lead table
   - status chips
   - primary CTA

6. `/leads/new`
   - form clarity
   - focus states
   - review notice

7. `/opportunities`
   - pipeline table
   - stage readability
   - next-action clarity

8. `/opportunities/<demo-id>`
   - value card
   - qualification panel
   - ADOREN business summary boundary
   - action controls

9. `/documents`
   - document list
   - version/status hierarchy
   - open action

10. `/commissions`
    - finance KPIs
    - commission states
    - ledger logic note

11. `/support`
    - VITO premium treatment
    - human support hierarchy
    - disabled integration states

12. `/profile`
    - role / authorization
    - authorized portfolio
    - governance acknowledgements

13. `/policies`
    - policy versions
    - acceptance / reaccept states

14. `/admin`
    - internal-only owner review surface
    - applications
    - conflicts
    - authorizations
    - owner gates

15. `/search`
    - permission-aware search layout
    - search field focus treatment

16. `/review`
    - product review checklist

## Must remain true

- No Auth0 connection
- No database migration
- No API writes
- No production customer data
- No provider calls
- No live ADOREN integration
- No production deployment
- No public route
- No merge without explicit owner approval

## UI acceptance criteria

PASS when:
- text is comfortably readable at 100% zoom
- gold A/Λ reads unmistakably as the URTALI A
- surfaces feel dimensional but not decorative
- hero remains the dominant visual moment
- operational controls remain more prominent than decoration
- no page feels flatter or cheaper than the dashboard
- no important content depends on hover
- disabled functionality is clearly labelled
- synthetic demo companies cannot be mistaken for real clients

## Next gate after owner visual approval

Only after explicit approval:

1. freeze visual baseline
2. security / data-boundary review
3. Auth0 session contract
4. Prisma / API / Audit integration design
5. isolated staging implementation
6. staging QA
7. explicit production release decision

No step above is implicitly authorized by visual approval.
