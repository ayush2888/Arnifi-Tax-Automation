"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  FileText,
  Landmark,
  Settings2,
  Upload,
  ArrowLeftRight,
  CheckCircle2,
} from "lucide-react";

import { useBooksShell } from "@/components/books/books-shell-context";
import { CreateClientForm, EnsurePeriodsForm } from "@/components/create-client-form";
import { PageHeader } from "@/components/page-header";

type DashboardPayload = {
  statements: number;
  transactions: number;
  inboxToReview: number;
  statementsStuck: number;
  bankUnclassified: number;
  bankNeedsReview: number;
  draftJournals: number;
  balanceFailures: number;
};

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  count: number;
  href: string;
  icon: typeof FileText;
};

const EMPTY: DashboardPayload = {
  statements: 0,
  transactions: 0,
  inboxToReview: 0,
  statementsStuck: 0,
  bankUnclassified: 0,
  bankNeedsReview: 0,
  draftJournals: 0,
  balanceFailures: 0,
};

export default function DashboardPage() {
  const { clientId } = useBooksShell();
  const [clientName, setClientName] = useState("");
  const [data, setData] = useState<DashboardPayload>(EMPTY);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(clientId));
  const [setupOpen, setSetupOpen] = useState(!clientId);

  useEffect(() => {
    if (!clientId) {
      setClientName("");
      setData(EMPTY);
      setSetupOpen(true);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSetupOpen(false);
    setError("");
    Promise.all([
      fetch("/api/session").then((r) => r.json()),
      fetch("/api/dashboard").then(async (r) => {
        if (!r.ok) throw new Error("Could not load home.");
        return r.json();
      }),
    ])
      .then(([book, dash]) => {
        if (cancelled) return;
        const name = book.clients?.find((c: { id: string; name: string }) => c.id === book.clientId)?.name;
        setClientName(name || "");
        setData({
          statements: Number(dash.statements || 0),
          transactions: Number(dash.transactions || 0),
          inboxToReview: Number(dash.inboxToReview || 0),
          statementsStuck: Number(dash.statementsStuck || 0),
          bankUnclassified: Number(dash.bankUnclassified || 0),
          bankNeedsReview: Number(dash.bankNeedsReview ?? dash.needsReview ?? 0),
          draftJournals: Number(dash.draftJournals || 0),
          balanceFailures: Number(dash.balanceFailures || 0),
        });
      })
      .catch(() => {
        if (!cancelled) setError("Could not load home. Is the database running?");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const attention = useMemo(() => buildAttention(data), [data]);
  const ctas = useMemo(() => buildPrimaryCtas(data, attention), [data, attention]);
  const totalAttention = attention.reduce((sum, item) => sum + item.count, 0);

  if (!clientId) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Home"
          description="Create a company to start. Months are generated from the fiscal year you choose."
        />
        <section className="ab-panel p-5">
          <h2 className="font-heading text-base font-semibold">Create your first company</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            After that you can upload invoices and bank statements for any open month.
          </p>
          <div className="mt-4">
            <CreateClientForm />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Home"
        description={
          loading
            ? `${clientName || "Company"} — loading work queue…`
            : totalAttention > 0
              ? `${clientName || "Company"} — ${totalAttention} item${totalAttention === 1 ? "" : "s"} need attention.`
              : `${clientName || "Company"} — nothing waiting. Upload the next documents when ready.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {ctas.map((cta) => (
              <Link
                key={cta.href + cta.label}
                href={cta.href}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-95"
              >
                {cta.label}
                <ArrowRight className="size-3.5" />
              </Link>
            ))}
          </div>
        }
      />

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="ab-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-heading text-base font-semibold">Needs attention</h2>
            <p className="text-sm text-muted-foreground">Open a row to clear the queue for this company.</p>
          </div>
          {!loading && totalAttention === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--status-ok)]">
              <CheckCircle2 className="size-4" />
              Clear
            </span>
          ) : null}
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Loading…</p>
        ) : attention.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-foreground">Nothing needs you right now.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload bank statements or invoices when the next pack arrives.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/statements"
                className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                Upload bank statement
              </Link>
              <Link
                href="/inbox"
                className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                Upload invoices
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {attention.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-primary-subtle/40"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{item.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    <span className="tabular-nums text-sm font-semibold text-foreground">{item.count}</span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="ab-panel overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-primary-subtle/50"
          onClick={() => setSetupOpen((v) => !v)}
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary-subtle text-primary">
              <Settings2 className="size-4" />
            </span>
            <div>
              <p className="font-medium text-foreground">Company setup</p>
              <p className="text-sm text-muted-foreground">Add another company or generate months for a fiscal year</p>
            </div>
          </div>
          <span className="text-xs font-medium text-primary">{setupOpen ? "Hide" : "Show"}</span>
        </button>
        {setupOpen ? (
          <div className="space-y-4 border-t border-border p-5">
            <CreateClientForm />
            <EnsurePeriodsForm />
          </div>
        ) : null}
      </div>

      {data.balanceFailures > 0 ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {data.balanceFailures} bank statement{data.balanceFailures === 1 ? "" : "s"} have balance check issues.{" "}
          <Link href="/statements" className="font-medium underline-offset-2 hover:underline">
            Review statements
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function buildAttention(data: DashboardPayload): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (data.inboxToReview > 0) {
    items.push({
      id: "inbox",
      title: "Inbox to review",
      detail: "Invoices and bills waiting for check or post",
      count: data.inboxToReview,
      href: "/inbox",
      icon: FileText,
    });
  }
  if (data.statementsStuck > 0) {
    items.push({
      id: "statements",
      title: "Bank statements stuck",
      detail: "Still extracting, need mapping, or failed",
      count: data.statementsStuck,
      href: "/statements",
      icon: Upload,
    });
  }
  if (data.bankUnclassified > 0) {
    items.push({
      id: "bank-uncat",
      title: "Unclassified bank lines",
      detail: "Categorise before reconcile",
      count: data.bankUnclassified,
      href: "/transactions?tab=unclassified",
      icon: ArrowLeftRight,
    });
  } else if (data.bankNeedsReview > 0) {
    items.push({
      id: "bank-review",
      title: "Bank lines need review",
      detail: "Flags kept on the row until you clear them",
      count: data.bankNeedsReview,
      href: "/transactions?tab=needs_review",
      icon: ArrowLeftRight,
    });
  }
  if (data.draftJournals > 0) {
    items.push({
      id: "drafts",
      title: "Draft journals",
      detail: "Not posted yet — books ignore drafts",
      count: data.draftJournals,
      href: "/journals",
      icon: Landmark,
    });
  }
  return items.sort((a, b) => b.count - a.count);
}

function buildPrimaryCtas(data: DashboardPayload, attention: AttentionItem[]) {
  if (attention.length >= 2) {
    return attention.slice(0, 2).map((item) => ({
      label: `${shortCta(item.id)} (${item.count})`,
      href: item.href,
    }));
  }
  if (attention.length === 1) {
    const first = attention[0]!;
    const fallback =
      first.id === "inbox"
        ? { label: "Upload bank statement", href: "/statements" }
        : { label: "Open inbox", href: "/inbox" };
    return [{ label: `${shortCta(first.id)} (${first.count})`, href: first.href }, fallback];
  }
  // Quiet desk — always offer the two start actions.
  if (data.statements === 0) {
    return [
      { label: "Upload bank statement", href: "/statements" },
      { label: "Upload invoices", href: "/inbox" },
    ];
  }
  return [
    { label: "Open inbox", href: "/inbox" },
    { label: "Bank statements", href: "/statements" },
  ];
}

function shortCta(id: string) {
  if (id === "inbox") return "Review inbox";
  if (id === "statements") return "Fix statements";
  if (id === "bank-uncat") return "Categorise bank";
  if (id === "bank-review") return "Review bank";
  if (id === "drafts") return "Open drafts";
  return "Open";
}
