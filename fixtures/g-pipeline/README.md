# Stage G pipeline goldens

Hand-computed expected VAT201 / TB JSON for the three synthetic demo clients seeded in `db/15-pipeline-demo.sql`.

| Folder | Client | Period |
|---|---|---|
| `a/` | Sandstorm Services LLC | 2026-01 |
| `b/` | Caravan Trading LLC | 2026-01 |
| `c/` | Palm Realty LLC | Q1 2026 |

Amounts are integer minor units. Used by `src/server/g-pipeline.test.ts`.
