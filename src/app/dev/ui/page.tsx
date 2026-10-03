"use client";

import { useState } from "react";

import {
  CellAccount,
  CellAmount,
  CellAvatar,
  CellDate,
  CellEntryId,
  CellReadMore,
  CellScorePill,
  CellStatusPill,
  CellTags,
  CellTypePill,
} from "@/components/books/cells";
import { BooksDataGrid, type BooksGridColumn } from "@/components/books/data-grid";
import { BooksSideDrawer } from "@/components/books/side-drawer";
import { SecurityBannerChip, MfaDownloadModal } from "@/components/security-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const demoRows = [
  {
    id: "1",
    entryDate: "2026-06-15",
    entryNo: "JE-2026-0042",
    description: "Stripe payout reconciliation",
    entryType: "auto",
    status: "posted",
    amount: 105000,
    debitAccount: { code: "1000", name: "Bank AED", vatTreatment: null },
    creditAccount: { code: "4000", name: "Revenue", vatTreatment: "standard" },
    tags: ["stripe", "june"],
  },
  {
    id: "2",
    entryDate: "2026-06-02",
    entryNo: null,
    description: "Draft accrual",
    entryType: "manual",
    status: "draft",
    amount: 50000,
    debitAccount: { code: "6100", name: "Rent", vatTreatment: "standard" },
    creditAccount: { code: "2100", name: "Accrued expenses", vatTreatment: null },
    tags: [],
  },
];

type DemoRow = (typeof demoRows)[number];

export default function DevUiPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);

  const columns: BooksGridColumn<DemoRow>[] = [
    { id: "date", header: "Date", cell: (r) => <CellDate value={r.entryDate} /> },
    { id: "id", header: "Entry ID", cell: (r) => <CellEntryId entryNo={r.entryNo} id={r.id} /> },
    { id: "desc", header: "Description", cell: (r) => <CellReadMore text={r.description} /> },
    { id: "dr", header: "Debit", cell: (r) => <CellAccount account={r.debitAccount} /> },
    { id: "cr", header: "Credit", cell: (r) => <CellAccount account={r.creditAccount} /> },
    { id: "amt", header: "Amount", className: "text-right", cell: (r) => <CellAmount minor={r.amount} /> },
    { id: "type", header: "Type", cell: (r) => <CellTypePill entryType={r.entryType} /> },
    { id: "status", header: "Status", cell: (r) => <CellStatusPill status={r.status} /> },
    { id: "tags", header: "Tags", cell: (r) => <CellTags tags={r.tags} /> },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-10 py-4">
      <div>
        <h1 className="text-2xl font-semibold">UI gallery</h1>
        <p className="text-sm text-muted-foreground">Track 1 components and states for visual QA.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Security chip</h2>
        <SecurityBannerChip />
        <Button variant="outline" size="sm" onClick={() => setMfaOpen(true)}>
          Open MFA download modal
        </Button>
        <MfaDownloadModal open={mfaOpen} onOpenChange={setMfaOpen} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Cells</h2>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
          <CellAvatar name="Omar Hassan" />
          <CellScorePill score={92} />
          <Badge>Beta</Badge>
          <CellTypePill entryType="closing" />
          <CellStatusPill status="pending" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Data grid (demo data)</h2>
        <BooksDataGrid columns={columns} rows={demoRows} onRowClick={() => setDrawerOpen(true)} groupByMonth />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Empty / loading</h2>
        <BooksDataGrid columns={columns} rows={[]} emptyLabel="Empty state example" />
        <BooksDataGrid columns={columns} rows={[]} loading />
      </section>

      <BooksSideDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Demo entry"
        entryNo="JE-2026-0042"
        status="posted"
        entryType="auto"
        source="app"
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "audit", label: "Audit Log & Linked Entries" },
        ]}
        activeTab="overview"
      >
        <p className="text-sm text-muted-foreground">Drawer body stub from gallery.</p>
      </BooksSideDrawer>
    </div>
  );
}
