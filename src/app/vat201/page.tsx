"use client";

import { useEffect, useState } from "react";

import { DEMO_PERIOD_ID } from "@/config/product";
import { Button } from "@/components/ui/button";

type Draft = {
  period: { id: string; label: string; status?: string };
  boxes: Record<string, { taxableMinor: number; vatMinor: number }>;
  totalOutputVat: number;
  totalInputVat: number;
  netPayable: number;
  status: string;
  note: string;
  latestPack: {
    id: string;
    version: number;
    status: string;
    contentHash: string;
    preparedBy: string;
    approvedBy: string | null;
    releasedAt: string | null;
  } | null;
};

type Pack = {
  id: string;
  version: number;
  status: string;
  contentHash: string;
  preparedBy: string;
  approvedBy: string | null;
  releasedAt: string | null;
  preparerName?: string;
  approverName?: string | null;
  preparedAt?: string;
};

type DownloadEvent = {
  id: string;
  packId: string;
  userName: string;
  at: string;
  version: number;
  packStatus: string;
};

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Vat201Page() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [downloads, setDownloads] = useState<DownloadEvent[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    setError("");
    Promise.all([
      fetch(`/api/periods/${DEMO_PERIOD_ID}/vat201-draft`).then(async (r) => {
        if (!r.ok) throw new Error("draft");
        return r.json();
      }),
      fetch(`/api/release-packs?periodId=${encodeURIComponent(DEMO_PERIOD_ID)}`).then((r) => r.json()),
      fetch("/api/downloads").then((r) => r.json()),
    ])
      .then(([nextDraft, nextPacks, nextDownloads]) => {
        setDraft(nextDraft);
        setPacks(nextPacks);
        setDownloads(nextDownloads);
      })
      .catch(() => setError("Could not load VAT201 draft. Ensure the demo period and release tables exist."));
  }

  useEffect(() => {
    load();
  }, []);

  async function prepare() {
    setError("");
    setMessage("");
    const response = await fetch(`/api/periods/${DEMO_PERIOD_ID}/vat201-prepare`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Prepare failed.");
      return;
    }
    setMessage(`Prepared v${payload.version} — switch to Layla (admin) in the sidebar to approve.`);
    load();
  }

  async function approve(packId: string) {
    setError("");
    setMessage("");
    const response = await fetch(`/api/release-packs/${packId}/approve`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Approve failed. Preparer cannot approve their own pack.");
      return;
    }
    setMessage(`Released v${payload.id ? "" : ""}${payload.status}. Download is unlocked.`);
    load();
  }

  async function download(packId: string, version: number) {
    setError("");
    setMessage("");
    const response = await fetch(`/api/release-packs/${packId}/download`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Download blocked.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vat201-v${version}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Download logged. File the return in the FTA portal outside arnibooks.");
    load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">VAT201</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Draft from the ledger, then dual-control release (preparer ≠ approver). Download shows status, version, and date;
          every download is audited. The product never submits to the FTA.
        </p>
      </header>
      <Button variant="outline" size="sm" onClick={load}>
        Refresh
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {!draft && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {draft ? (
        <div className="space-y-4">
          <p className="text-sm">
            {draft.period.label} · live {draft.status}
            {draft.latestPack
              ? ` · latest pack v${draft.latestPack.version} (${draft.latestPack.status})`
              : " · no pack yet"}
          </p>
          <table className="w-full max-w-xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3">Box</th>
                <th className="py-2 pr-3">Taxable (AED)</th>
                <th className="py-2">VAT (AED)</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(draft.boxes).length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-3 text-muted-foreground">
                    No VAT-tagged postings yet. Approve sales/purchase fixtures in Inbox.
                  </td>
                </tr>
              ) : (
                Object.entries(draft.boxes).map(([box, amounts]) => (
                  <tr key={box} className="border-b border-border">
                    <td className="py-2 pr-3 font-medium">{box}</td>
                    <td className="py-2 pr-3">{fils(amounts.taxableMinor)}</td>
                    <td className="py-2">{fils(amounts.vatMinor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <dl className="grid max-w-xl gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Total output VAT</dt>
              <dd>{fils(draft.totalOutputVat)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Total input VAT</dt>
              <dd>{fils(draft.totalInputVat)}</dd>
            </div>
            <div className="flex justify-between gap-4 font-medium">
              <dt>Net payable</dt>
              <dd>{fils(draft.netPayable)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button onClick={prepare}>Prepare for approval</Button>
          </div>
          <p className="text-xs text-muted-foreground">{draft.note}</p>
        </div>
      ) : null}

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Release packs</h2>
        {packs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No packs yet.</p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {packs.map((pack) => (
              <li key={pack.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
                <div>
                  <div className="font-medium">
                    v{pack.version} · {pack.status}
                  </div>
                  <div className="text-muted-foreground">
                    Prepared by {pack.preparerName || pack.preparedBy.slice(0, 8)}
                    {pack.approverName ? ` · approved by ${pack.approverName}` : ""}
                    {pack.releasedAt ? ` · released ${String(pack.releasedAt).slice(0, 10)}` : ""}
                  </div>
                  <code className="text-xs text-muted-foreground">{pack.contentHash.slice(0, 12)}…</code>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pack.status === "PENDING_APPROVAL" || pack.status === "DRAFT" ? (
                    <Button size="sm" variant="outline" onClick={() => approve(pack.id)}>
                      Approve &amp; release
                    </Button>
                  ) : null}
                  {pack.status === "RELEASED" ? (
                    <Button size="sm" onClick={() => download(pack.id, pack.version)}>
                      Download
                    </Button>
                  ) : null}
                  {pack.status === "STALE" ? (
                    <span className="text-xs text-danger">Stale — prepare a new version</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Download log</h2>
        {downloads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No downloads yet.</p>
        ) : (
          <ul className="divide-y divide-border border border-border text-sm">
            {downloads.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>
                  {event.userName} · pack v{event.version}
                </span>
                <span className="text-muted-foreground">{String(event.at).replace("T", " ").slice(0, 19)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
