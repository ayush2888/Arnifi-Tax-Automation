"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { formatMinor } from "@/lib/money";

type LedgerLine = {
  entryId: string;
  entryNo: string | null;
  entryDate: string;
  memo: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
};

function AccountLedgerInner() {
  const params = useSearchParams();
  const periodId = params.get("periodId") || "";
  const accountId = params.get("accountId") || "";
  const [data, setData] = useState<{
    periodLabel: string;
    account: { code: string; name: string };
    lines: LedgerLine[];
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!periodId || !accountId) return;
    fetch(`/api/books/account-ledger?periodId=${periodId}&accountId=${accountId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(String(json.error));
        else setData(json);
      })
      .catch(() => setError("load_failed"));
  }, [periodId, accountId]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/books/reports/trial-balance" className="text-sm text-muted-foreground underline">
          ← Trial balance
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Account ledger</h1>
        {data ? (
          <p className="text-sm text-muted-foreground">
            {data.account.code} · {data.account.name} · {data.periodLabel}
          </p>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/95">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Entry</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data?.lines.map((line) => (
              <tr key={`${line.entryId}-${line.entryDate}-${line.debitMinor}`} className="border-t border-border">
                <td className="px-3 py-2 whitespace-nowrap">{line.entryDate}</td>
                <td className="px-3 py-2 font-mono text-xs">{line.entryNo || line.entryId.slice(0, 8)}</td>
                <td className="px-3 py-2">{line.memo}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {line.debitMinor ? formatMinor(line.debitMinor) : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {line.creditMinor ? formatMinor(line.creditMinor) : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {formatMinor(line.balanceMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AccountLedgerPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading account ledger…</p>}>
      <AccountLedgerInner />
    </Suspense>
  );
}
