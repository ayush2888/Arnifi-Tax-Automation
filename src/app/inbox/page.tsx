"use client";

import { useEffect, useState } from "react";

import { DEMO_PERIOD_ID } from "@/config/product";
import { Button } from "@/components/ui/button";

type DocumentRow = {
  id: string;
  docType: string;
  originalName: string;
  status: string;
  periodLabel: string;
  extractionId: string | null;
  extractionStatus: string | null;
};

const SALES_FIXTURE = {
  entryDate: "2026-01-20",
  invoiceNumber: "INV-1001",
  counterparty: "Desert Retail LLC",
  taxableMinor: 100000,
  vatMinor: 5000,
};

const PURCHASE_FIXTURE = {
  entryDate: "2026-01-22",
  invoiceNumber: "BILL-2001",
  counterparty: "Oasis Supplies FZE",
  taxableMinor: 40000,
  vatMinor: 2000,
};

export default function InboxPage() {
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    fetch(`/api/documents?periodId=${encodeURIComponent(DEMO_PERIOD_ID)}`)
      .then((r) => r.json())
      .then(setDocuments)
      .catch(() => setError("Could not load inbox."));
  }

  useEffect(() => {
    load();
  }, []);

  async function loadFixture(docType: "SALES_INVOICE" | "PURCHASE_INVOICE") {
    setError("");
    setMessage("");
    const facts = docType === "SALES_INVOICE" ? SALES_FIXTURE : PURCHASE_FIXTURE;
    const response = await fetch("/api/documents/synthetic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodId: DEMO_PERIOD_ID,
        docType,
        originalName: `${docType.toLowerCase()}-fixture.json`,
        facts,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Fixture load failed.");
      return;
    }
    setMessage(`${docType} fixture loaded for review.`);
    load();
  }

  async function approvePost(extractionId: string) {
    setError("");
    setMessage("");
    const response = await fetch(`/api/extractions/${extractionId}/approve-post`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Approve/post failed.");
      return;
    }
    const payload = await response.json();
    setMessage(`Posted journal ${payload.journalEntryId.slice(0, 8)}…`);
    load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Inbox</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Synthetic document review only — paste-style fixtures, no cloud OCR. Approve creates a source-linked posted journal.
        </p>
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => loadFixture("SALES_INVOICE")}>
          Load sales fixture
        </Button>
        <Button variant="outline" onClick={() => loadFixture("PURCHASE_INVOICE")}>
          Load purchase fixture
        </Button>
      </div>

      {documents === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet. Load a synthetic fixture to begin.</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
              <div>
                <div className="font-medium">
                  {doc.docType} · {doc.originalName}
                </div>
                <div className="text-muted-foreground">
                  {doc.periodLabel} · doc {doc.status}
                  {doc.extractionStatus ? ` · extraction ${doc.extractionStatus}` : ""}
                </div>
              </div>
              {doc.extractionId && doc.status !== "posted" ? (
                <Button size="sm" onClick={() => approvePost(doc.extractionId!)}>
                  Approve &amp; post
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">posted</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
