import Link from "next/link";

export default function BooksHomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the main menu for the real notebook. These links open the same company screens as Bank, Ledger, and
          Reports.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/journals"
          className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40"
        >
          <h2 className="font-medium">Ledger</h2>
          <p className="mt-1 text-sm text-muted-foreground">Review and post journal entries in journal_*.</p>
        </Link>
        <Link
          href="/reports"
          className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40"
        >
          <h2 className="font-medium">Reports</h2>
          <p className="mt-1 text-sm text-muted-foreground">Profit and loss and balance sheet from that ledger.</p>
        </Link>
        <Link
          href="/transactions"
          className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40"
        >
          <h2 className="font-medium">Bank</h2>
          <p className="mt-1 text-sm text-muted-foreground">Statement rows extracted by the worker.</p>
        </Link>
        <Link
          href="/vat201"
          className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40"
        >
          <h2 className="font-medium">VAT</h2>
          <p className="mt-1 text-sm text-muted-foreground">Draft VAT201 from posted journals.</p>
        </Link>
      </div>
    </div>
  );
}
