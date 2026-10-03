# V1 VAT201 goldens (roadmap §3.4)

Back-test arnibooks VAT201 drafts against **filed** returns the owner supplies. Data stays on-machine; nothing is sent externally.

## Layout

| Path | Purpose |
|---|---|
| `lab/` | Synthetic goldens checked into git for CI / local harness |
| `filed/` | Drop owner-supplied JSON goldens here (gitignored contents except `.gitkeep`) |

## Golden JSON shape

```json
{
  "id": "client-period-label",
  "source": "filed",
  "clientId": "uuid",
  "periodId": "uuid",
  "periodLabel": "Q1 2026",
  "toleranceMinor": 0,
  "boxes": {
    "1b": { "taxableMinor": 0, "vatMinor": 0 },
    "9": { "taxableMinor": 0, "vatMinor": 0 }
  },
  "totalOutputVat": 0,
  "totalInputVat": 0,
  "netPayable": 0,
  "notes": "optional"
}
```

Amounts are **integer minor units** (AED fils). `toleranceMinor` is the absolute allowance per field.

## Run

```bash
# Pure compare unit tests + lab replay against daftar_test
npm test

# CLI against a golden file and an actual payload JSON
npx tsx scripts/v1-backtest.ts --golden fixtures/v1-goldens/lab/al-noor-q1-2026.golden.json --actual path/to/actual.json
```

V1 **exit** requires filed goldens in `filed/` matching within tolerance. Until those arrive, only `lab/` runs in CI.
