"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { VirtualItem } from "@tanstack/react-virtual";

import { VirtualGrid, type VirtualGridHandle } from "./virtual-grid";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WINDOW, windowFor } from "@/lib/fetch-window";
import { locate, type MonthBucket } from "@/lib/grid-layout";
import { displayToMinor, formatMinor, MoneyTypeError } from "@/lib/money";

import { RecordDrawer } from "./drawer";
import { DEFAULT_COLUMNS, EMPTY_FILTERS, type Category, type Column, type Filters, type Txn } from "./types";

type Meta = { all: number; needsReview: number; unclassified: number; months: MonthBucket[] };

export function Workspace() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const record = search.get("record");
  const gridRef = useRef<VirtualGridHandle>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [canWrite, setCanWrite] = useState(true);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pages, setPages] = useState<Record<number, Txn[]>>({});
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [active, setActive] = useState(0);
  const [views, setViews] = useState<{ id: string; name: string; config: unknown }[]>([]);
  const [viewName, setViewName] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const inflight = useRef(new Set<number>());

  const visible = columns.filter((column) => column.visible);
  const tableWidth = visible.reduce((sum, column) => sum + column.width, 0);
  const months = useMemo(
    () => (filters.groupByMonth ? (meta?.months ?? []) : null),
    [filters.groupByMonth, meta],
  );
  const slotCount = months ? total + months.length : total;

  const queryString = useMemo(() => buildQuery(filters), [filters]);

  const ensureWindow = useCallback(
    async (offset: number) => {
      if (pages[offset] || inflight.current.has(offset)) return;
      inflight.current.add(offset);
      try {
        const response = await fetch(`/api/transactions?${queryString}&offset=${offset}&limit=${WINDOW}`);
        if (!response.ok) throw new Error("Could not load transactions.");
        const payload = await response.json();
        setTotal(payload.total);
        setPages((current) => ({ ...current, [offset]: payload.rows }));
      } finally {
        inflight.current.delete(offset);
      }
    },
    [pages, queryString],
  );

  useEffect(() => {
    let stop = false;
    setLoading(true);
    setPages({});
    setSelected(new Set());
    inflight.current.clear();
    Promise.all([
      fetch(`/api/transactions?${queryString}&offset=0&limit=${WINDOW}`).then(async (response) => {
        if (!response.ok) throw new Error("Could not load transactions.");
        return response.json();
      }),
      fetch(`/api/transactions/meta?${queryString}`).then((response) => response.json()),
      fetch("/api/categories").then((response) => response.json()),
      fetch("/api/session").then((response) => response.json()),
      fetch("/api/views").then((response) => response.json()),
    ])
      .then(([list, counts, cats, session, saved]) => {
        if (stop) return;
        setPages({ 0: list.rows });
        setTotal(list.total);
        setMeta(counts);
        setCategories(cats);
        setCanWrite(session.me?.role !== "viewer");
        setViews(saved);
        setError("");
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message);
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [queryString, revision]);

  const [virtualItems, setVirtualItems] = useState<VirtualItem[]>([]);
  useEffect(() => {
    if (!virtualItems.length || !total) return;
    const indexes = virtualItems
      .map((item) => locate(item.index, total, months))
      .filter((slot) => slot.type === "row")
      .map((slot) => (slot.type === "row" ? slot.rowIndex : 0));
    if (!indexes.length) return;
    const window = windowFor(Math.min(...indexes), Math.max(...indexes));
    for (let offset = window.offset; offset < window.offset + window.limit; offset += WINDOW) {
      void ensureWindow(offset);
    }
  }, [virtualItems, total, months, ensureWindow]);

  function openRecord(id: string) {
    const params = new URLSearchParams(search.toString());
    params.set("record", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeRecord() {
    const params = new URLSearchParams(search.toString());
    params.delete("record");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  function rowAt(index: number): Txn | undefined {
    const offset = Math.floor(index / WINDOW) * WINDOW;
    return pages[offset]?.[index - offset];
  }

  function applyFilters() {
    try {
      if (draft.amountMin) displayToMinor(draft.amountMin);
      if (draft.amountMax) displayToMinor(draft.amountMax);
      setFilters({ ...draft, tab: filters.tab, sort: filters.sort, dir: filters.dir, groupByMonth: filters.groupByMonth });
      setError("");
    } catch (reason) {
      if (reason instanceof MoneyTypeError) setError("Amount filters use minor-unit display text, such as 250.00.");
    }
  }

  async function exportCsv() {
    const response = await fetch(`/api/transactions/export?${queryString}`);
    if (!response.ok) {
      setError("Export failed.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transactions.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function bulk(allMatching: boolean) {
    if (!bulkCategory) return;
    const response = await fetch(`/api/transactions/bulk-category?${queryString}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: bulkCategory,
        ids: allMatching ? null : [...selected],
        allMatching,
      }),
    });
    if (!response.ok) {
      setError("Bulk categorise was refused.");
      return;
    }
    setSelected(new Set());
    setRevision((value) => value + 1);
  }

  async function saveView() {
    if (!viewName.trim()) return;
    await fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: viewName.trim(), config: { columns, filters } }),
    });
    setViews(await fetch("/api/views").then((response) => response.json()));
    setViewName("");
  }

  function applyView(config: unknown) {
    const saved = config as { columns?: Column[]; filters?: Filters };
    if (saved.columns) setColumns(saved.columns);
    if (saved.filters) {
      setFilters(saved.filters);
      setDraft(saved.filters);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(total - 1, active + 1);
      setActive(next);
      gridRef.current?.scrollToIndex(months ? indexForRow(next, months) : next);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, active - 1);
      setActive(next);
      gridRef.current?.scrollToIndex(months ? indexForRow(next, months) : next);
    }
    if (event.key === "Enter") {
      const row = rowAt(active);
      if (row) openRecord(row.id);
    }
  }

  const neighbors = useMemo(() => {
    if (!record) return { prev: null as string | null, next: null as string | null };
    const flat: string[] = [];
    const offsets = Object.keys(pages).map(Number).sort((a, b) => a - b);
    for (const offset of offsets) {
      for (const row of pages[offset] || []) flat.push(row.id);
    }
    const index = flat.indexOf(record);
    return {
      prev: index > 0 ? flat[index - 1] : null,
      next: index >= 0 && index < flat.length - 1 ? flat[index + 1] : null,
    };
  }, [pages, record]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">Classification and match stay separate. Match is unused in this phase.</p>
        </div>
        <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
      </header>
      {meta && meta.needsReview > 0 ? (
        <p className="rounded-lg border border-warn bg-warn/10 px-3 py-2 text-sm text-warn">
          {meta.needsReview} rows need review. Flags are kept on the row; nothing is rewritten.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {[
          ["all", `All ${meta ? meta.all : ""}`],
          ["needs_review", `Needs review ${meta ? meta.needsReview : ""}`],
          ["unclassified", `Unclassified ${meta ? meta.unclassified : ""}`],
        ].map(([id, label]) => (
          <Button key={id} size="sm" variant={filters.tab === id ? "default" : "outline"} onClick={() => setFilters({ ...filters, tab: id })}>
            {label}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-6">
        <Input placeholder="Search description or reference" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} />
        <Input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} aria-label="From date" />
        <Input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} aria-label="To date" />
        <Input placeholder="Min amount" value={draft.amountMin} onChange={(event) => setDraft({ ...draft, amountMin: event.target.value })} />
        <Input placeholder="Max amount" value={draft.amountMax} onChange={(event) => setDraft({ ...draft, amountMax: event.target.value })} />
        <select className="h-8 rounded-lg border border-input bg-card px-2 text-sm" value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })} aria-label="Category filter">
          <option value="">Any category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <Input placeholder="Flag" value={draft.flag} onChange={(event) => setDraft({ ...draft, flag: event.target.value })} />
        <Button size="sm" onClick={applyFilters}>Apply filters</Button>
        <Button size="sm" variant={filters.groupByMonth ? "default" : "outline"} onClick={() => setFilters({ ...filters, groupByMonth: !filters.groupByMonth })}>
          Group by month
        </Button>
        <Button size="sm" variant="outline" onClick={() => setColumnsOpen((value) => !value)}>Columns</Button>
      </div>
      {columnsOpen ? (
        <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-3 text-sm">
          {columns.map((column, index) => (
            <label key={column.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={column.visible}
                disabled={column.id === "reference"}
                onChange={(event) => {
                  const next = columns.slice();
                  next[index] = { ...column, visible: event.target.checked };
                  setColumns(next);
                }}
              />
              {column.label}
              <button type="button" className="text-xs text-muted-foreground" onClick={() => moveColumn(index, -1)} aria-label={`Move ${column.label} earlier`}>←</button>
              <button type="button" className="text-xs text-muted-foreground" onClick={() => moveColumn(index, 1)} aria-label={`Move ${column.label} later`}>→</button>
            </label>
          ))}
          <div className="flex w-full gap-2">
            <Input placeholder="Name this view" value={viewName} onChange={(event) => setViewName(event.target.value)} />
            <Button size="sm" variant="outline" onClick={saveView}>Save view</Button>
            {views.map((view) => (
              <Button key={view.id} size="sm" variant="ghost" onClick={() => applyView(view.config)}>{view.name}</Button>
            ))}
          </div>
        </div>
      ) : null}
      {canWrite && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <select className="h-8 rounded-lg border border-input bg-card px-2" value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)} aria-label="Bulk category">
            <option value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <Button size="sm" onClick={() => bulk(false)}>Categorise selected</Button>
          <Button size="sm" variant="outline" onClick={() => bulk(true)}>Categorise all matching</Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading transactions…</p> : null}
      {!loading && total === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          No transactions match. Upload a statement, or switch client if this book is empty.
        </p>
      ) : null}
      {total > 0 ? (
        <VirtualGrid
          ref={gridRef}
          count={slotCount}
          estimateSize={(index) => (months && locate(index, total, months).type === "header" ? 28 : 36)}
          onVirtualItems={setVirtualItems}
          onKeyDown={onKeyDown}
          width={tableWidth}
          header={
            <div className="sticky top-0 z-30 flex border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground" style={{ width: tableWidth, minWidth: "100%" }}>
              {visible.map((column) => (
                <div key={column.id} className="relative shrink-0 px-2 py-2" style={{ width: column.width }}>
                  <button type="button" className="font-medium" onClick={() => toggleSort(column.id)}>
                    {column.label}
                    {sortKey(column.id) === filters.sort ? (filters.dir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${column.label}`}
                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize"
                    onPointerDown={(event) => startResize(event, column.id)}
                  />
                </div>
              ))}
            </div>
          }
          renderItem={(item) => {
            const slot = locate(item.index, total, months);
            if (slot.type === "header") {
              return (
                <div className="flex items-center bg-secondary px-2 text-xs font-medium" style={{ height: item.size, width: tableWidth }}>
                  {slot.month}
                </div>
              );
            }
            const row = rowAt(slot.rowIndex);
            return (
              <div className={`flex border-b border-border text-sm ${active === slot.rowIndex ? "bg-muted" : ""}`} style={{ height: item.size, width: tableWidth }}>
                {row ? visible.map((column) => (
                  <div
                    key={column.id}
                    className={`shrink-0 truncate px-2 py-1.5 ${column.align === "right" ? "nums text-right" : ""} ${column.id === "reference" ? "sticky left-0 z-20 bg-card" : ""}`}
                    style={{ width: column.width }}
                  >
                    {renderCell(column.id, row)}
                  </div>
                )) : <span className="px-2 text-muted-foreground">Loading…</span>}
              </div>
            );
          }}
        />
      ) : null}
      {record ? (
        <RecordDrawer
          id={record}
          canWrite={canWrite}
          categories={categories}
          onClose={closeRecord}
          hasPrev={Boolean(neighbors.prev)}
          hasNext={Boolean(neighbors.next)}
          onPrev={() => neighbors.prev && openRecord(neighbors.prev)}
          onNext={() => neighbors.next && openRecord(neighbors.next)}
          onSaved={() => setRevision((value) => value + 1)}
        />
      ) : null}
    </div>
  );

  function renderCell(id: Column["id"], row: Txn) {
    if (id === "reference") {
      return (
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label={`Select ${row.reference || row.rowNo}`}
            checked={selected.has(row.id)}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.target.checked) next.add(row.id);
              else next.delete(row.id);
              setSelected(next);
            }}
          />
          <button type="button" className="truncate font-medium text-primary underline-offset-2 hover:underline" onClick={() => openRecord(row.id)}>
            {row.reference || `Row ${row.rowNo}`}
          </button>
        </span>
      );
    }
    if (id === "date") return row.txnDate || "";
    if (id === "description") return <span dir="auto">{row.descriptionClean || row.descriptionRaw}</span>;
    if (id === "counterparty") return <span dir="auto">{row.counterparty || ""}</span>;
    if (id === "debit") return <Amount minor={row.debitMinor} />;
    if (id === "credit") return <Amount minor={row.creditMinor} />;
    if (id === "balance") return <Amount minor={row.balanceMinor} />;
    if (id === "category") {
      return (
        <select
          className="h-7 w-full truncate bg-transparent text-sm"
          value={row.categoryId || ""}
          disabled={!canWrite}
          aria-label="Category"
          onChange={(event) => {
            void fetch(`/api/transactions/${row.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ categoryId: event.target.value || null }),
            }).then(() => setRevision((value) => value + 1));
          }}
        >
          <option value="">—</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      );
    }
    if (id === "classification") return row.classStatus;
    if (id === "review") return row.reviewStatus.replaceAll("_", " ");
    if (id === "match") return "Unmatched";
    if (id === "flags") return row.flags.join(", ");
    if (id === "confidence") return row.confidence == null ? "" : `${Math.round(row.confidence * 100)}%`;
    return row.statementLabel;
  }

  function toggleSort(id: Column["id"]) {
    const key = sortKey(id);
    if (!key) return;
    setFilters({ ...filters, sort: key, dir: filters.sort === key && filters.dir === "desc" ? "asc" : "desc" });
  }

  function moveColumn(index: number, delta: number) {
    const next = columns.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setColumns(next);
  }

  function startResize(event: React.PointerEvent, id: Column["id"]) {
    event.preventDefault();
    const startX = event.clientX;
    const start = columns.find((column) => column.id === id)?.width || 120;
    function move(next: PointerEvent) {
      const width = Math.max(72, start + next.clientX - startX);
      setColumns((current) => current.map((column) => (column.id === id ? { ...column, width } : column)));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}

function Amount({ minor }: { minor: number | null }) {
  const text = formatMinor(minor);
  if (!text) return null;
  return <span className={text.startsWith("-") ? "text-danger" : ""}>{text}</span>;
}

function sortKey(id: Column["id"]) {
  if (id === "date") return "date";
  if (id === "description") return "description";
  if (id === "debit") return "debit";
  if (id === "credit") return "credit";
  if (id === "balance") return "balance";
  if (id === "reference") return "reference";
  if (id === "confidence") return "confidence";
  return "";
}

function indexForRow(rowIndex: number, months: MonthBucket[]) {
  let cursor = 0;
  let seen = 0;
  for (const bucket of months) {
    if (rowIndex < seen + bucket.count) return cursor + 1 + (rowIndex - seen);
    seen += bucket.count;
    cursor += 1 + bucket.count;
  }
  return cursor;
}

function buildQuery(filters: Filters) {
  const params = new URLSearchParams();
  params.set("tab", filters.tab);
  params.set("sort", filters.sort);
  params.set("dir", filters.dir);
  if (filters.q) params.set("q", filters.q);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.amountMin) params.set("amountMinMinor", String(displayToMinor(filters.amountMin)));
  if (filters.amountMax) params.set("amountMaxMinor", String(displayToMinor(filters.amountMax)));
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.flag) params.set("flag", filters.flag);
  return params.toString();
}
