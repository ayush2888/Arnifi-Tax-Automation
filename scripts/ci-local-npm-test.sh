#!/usr/bin/env bash
set -eu
cp -a /src/. /work/
npm ci --silent
npx tsx --test \
  src/lib/money.test.ts \
  src/lib/currency.test.ts \
  src/lib/csv.test.ts \
  src/lib/date.test.ts \
  src/lib/grid-layout.test.ts \
  src/lib/fetch-window.test.ts \
  src/lib/highlight.test.ts \
  src/components/transactions/scroll.test.tsx \
  src/server/policy.test.ts \
  src/server/ledger.test.ts \
  src/server/release.test.ts \
  src/server/recon.test.ts \
  src/server/close.test.ts \
  src/server/statements.test.ts \
  src/server/ct.test.ts \
  src/server/security-gate.test.ts \
  src/server/vat201-compare.test.ts \
  src/server/pipeline-config.test.ts \
  src/server/pipeline.test.ts \
  src/server/propose.test.ts \
  src/server/inbox-route.test.ts \
  src/server/g-pipeline.test.ts \
  src/server/stage-g-regression.test.ts \
  src/server/unlock-proxy.test.ts \
  src/server/books/journals.test.ts \
  src/server/books/trial-balance.test.ts \
  src/server/books/security.test.ts \
  src/server/books/phase0-gaps.test.ts \
  src/server/books/schedule-post.test.ts
