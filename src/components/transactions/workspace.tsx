"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { VirtualItem } from "@tanstack/react-virtual";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WINDOW, windowFor } from "@/lib/fetch-window";
import { locate, type MonthBucket } from "@/lib/grid-layout";
import { displayToMinor, formatMinor, MoneyTypeError } from "@/lib/money";
import { cn } from "@/lib/utils";

import { RecordDrawer } from "./drawer";
import { DEFAULT_COLUMNS, EMPTY_FILTERS, type Category, type Column, type Filters, type Txn } from "./types";
import { VirtualGrid, type VirtualGridHandle } from "./virtual-grid";

type Meta = { all: number; needsReview: number; unclassified: number; months: MonthBucket[] };

export function Workspace() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const record = search.get("record");
  const tabFromUrl = search.get("tab");
  const initialTab =
    tabFromUrl === "needs_review" || tabFromUrl === "unclassified" || tabFromUrl === "all"
      ? tabFromUrl
      : EMPTY_FILTERS.tab;
  const gridRef = useRef<VirtualGridHandle>(null);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, tab: initialTab });
  const [draft, setDraft] = useState<Filters>({ ...EMPTY_FILTERS, tab: initialTab });
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
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const advancedActive = Boolean(
    draft.dateFrom || draft.dateTo || draft.amountMin || draft.amountMax || draft.categoryId || draft.flag,
  );

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

  function clearAdvanced() {
    const cleared = {
      ...draft,
      dateFrom: "",
      dateTo: "",
      amountMin: "",
      amountMax: "",
      categoryId: "",
      flag: "",
    };
    setDraft(cleared);
    setFilters({
      ...filters,
      dateFrom: "",
      dateTo: "",
      amountMin: "",
      amountMax: "",
      categoryId: "",
      flag: "",
      q: draft.q,
    });
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
    if (saved.columns?.length) {
      const byId = new Map(saved.columns.map((column) => [column.id, column]));
      // Keep the checkbox column even if an older saved view omitted it.
      const merged = DEFAULT_COLUMNS.map((column) => byId.get(column.id) ?? column);
      for (const column of saved.columns) {
        if (!merged.some((item) => item.id === column.id)) merged.push(column);
      }
      setColumns(merged);
    }
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

  const pageIds = useMemo(() => {
    const ids: string[] = [];
    for (const offset of Object.keys(pages).map(Number).sort((a, b) => a - b)) {
      for (const row of pages[offset] || []) ids.push(row.id);
    }
    return ids;
  }, [pages]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transactions"
        description={
          <>
            Lines from{" "}
            <Link href="/statements" className="font-medium text-primary hover:underline">
              Bank statements
            </Link>{" "}
            you uploaded. Categorise here; matching to journals is on Reconcile.
          </>
        }
        actions={
          <Button variant="outline" className="ab-soft-btn border-0 bg-white/70" onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      {meta && meta.needsReview > 0 ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {meta.needsReview} rows need review. Flags stay on the row; nothing is rewritten.
        </p>
      ) : null}

      <section className="ab-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All", meta?.all],
                ["needs_review", "Needs review", meta?.needsReview],
                ["unclassified", "Unclassified", meta?.unclassified],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                className={cn("ab-chip", filters.tab === id && "ab-chip-active")}
                onClick={() => setFilters({ ...filters, tab: id })}
              >
                {label}
                {typeof count === "number" ? (
                  <span className="ml-1 tabular-nums opacity-80">{count}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-9 w-full min-w-[12rem] sm:w-64"
              placeholder="Search description or reference"
              value={draft.q}
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyFilters();
              }}
            />
            <Button size="sm" variant="outline" onClick={applyFilters}>
              Search
            </Button>
            <Button
              size="sm"
              variant={filtersOpen || advancedActive ? "default" : "outline"}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              Filters{advancedActive ? " · on" : ""}
            </Button>
            <Button
              size="sm"
              variant={filters.groupByMonth ? "default" : "outline"}
              onClick={() => setFilters({ ...filters, groupByMonth: !filters.groupByMonth })}
            >
              By month
            </Button>
            <Button size="sm" variant="outline" onClick={() => setColumnsOpen((value) => !value)}>
              Columns
            </Button>
          </div>
        </div>

        {filtersOpen ? (
          <div className="grid gap-2 border-b border-border bg-muted/20 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <Input
              type="date"
              value={draft.dateFrom}
              onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })}
              aria-label="From date"
            />
            <Input
              type="date"
              value={draft.dateTo}
              onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })}
              aria-label="To date"
            />
            <Input
              placeholder="Min amount"
              value={draft.amountMin}
              onChange={(event) => setDraft({ ...draft, amountMin: event.target.value })}
            />
            <Input
              placeholder="Max amount"
              value={draft.amountMax}
              onChange={(event) => setDraft({ ...draft, amountMax: event.target.value })}
            />
            <select
              className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
              value={draft.categoryId}
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
              aria-label="Category filter"
            >
              <option value="">Any category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Input
              placeholder="Flag"
              value={draft.flag}
              onChange={(event) => setDraft({ ...draft, flag: event.target.value })}
            />
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-6">
              <Button size="sm" onClick={applyFilters}>
                Apply filters
              </Button>
              <Button size="sm" variant="ghost" onClick={clearAdvanced}>
                Clear
              </Button>
            </div>
          </div>
        ) : null}

        {columnsOpen ? (
          <div className="flex flex-wrap gap-3 border-b border-border bg-muted/20 px-4 py-3 text-sm">
            {columns
              .filter((column) => column.id !== "select")
              .map((column) => {
                const index = columns.findIndex((c) => c.id === column.id);
                return (
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
                    <button
                      type="button"
                      className="text-xs text-muted-foreground"
                      onClick={() => moveColumn(index, -1)}
                      aria-label={`Move ${column.label} earlier`}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground"
                      onClick={() => moveColumn(index, 1)}
                      aria-label={`Move ${column.label} later`}
                    >
                      →
                    </button>
                  </label>
                );
              })}
            <div className="flex w-full flex-wrap gap-2">
              <Input
                placeholder="Name this view"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
              />
              <Button size="sm" variant="outline" onClick={saveView}>
                Save view
              </Button>
              {views.map((view) => (
                <Button key={view.id} size="sm" variant="ghost" onClick={() => applyView(view.config)}>
                  {view.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {canWrite && selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-subtle/40 px-4 py-2.5 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <select
              className="h-8 rounded-lg border border-input bg-card px-2"
              value={bulkCategory}
              onChange={(event) => setBulkCategory(event.target.value)}
              aria-label="Bulk category"
            >
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => bulk(false)}>
              Categorise selected
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk(true)}>
              Categorise all matching
            </Button>
          </div>
        ) : null}

        {error ? <p className="px-4 py-2 text-sm text-danger">{error}</p> : null}
        {loading ? <p className="px-4 py-8 text-sm text-muted-foreground">Loading transactions…</p> : null}
        {!loading && total === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No transactions match.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a statement on{" "}
              <Link href="/statements" className="font-medium text-primary hover:underline">
                Bank statements
              </Link>
              , or switch company if this book is empty.
            </p>
          </div>
        ) : null}

        {total > 0 ? (
          <VirtualGrid
            ref={gridRef}
            count={slotCount}
            estimateSize={(index) => (months && locate(index, total, months).type === "header" ? 32 : 42)}
            onVirtualItems={setVirtualItems}
            onKeyDown={onKeyDown}
            width={tableWidth}
            header={
              <div
                className="sticky top-0 z-30 flex border-b border-border bg-muted/50 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                style={{ width: tableWidth, minWidth: "100%" }}
              >
                {visible.map((column) => (
                  <div
                    key={column.id}
                    className={cn(
                      "relative shrink-0 px-3 py-2.5",
                      column.align === "right" && "text-right",
                      column.id === "select" && "px-2",
                    )}
                    style={{ width: column.width }}
                  >
                    {column.id === "select" ? (
                      <input
                        type="checkbox"
                        aria-label="Select all loaded rows"
                        checked={allPageSelected}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) pageIds.forEach((id) => next.add(id));
                          else pageIds.forEach((id) => next.delete(id));
                          setSelected(next);
                        }}
                      />
                    ) : (
                      <button type="button" className="font-medium" onClick={() => toggleSort(column.id)}>
                        {column.label}
                        {sortKey(column.id) === filters.sort ? (filters.dir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    )}
                    {column.id !== "select" ? (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${column.label}`}
                        className="absolute top-0 right-0 h-full w-1 cursor-col-resize"
                        onPointerDown={(event) => startResize(event, column.id)}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            }
            renderItem={(item) => {
              const slot = locate(item.index, total, months);
              if (slot.type === "header") {
                return (
                  <div
                    className="flex items-center bg-secondary/80 px-3 text-xs font-semibold text-secondary-foreground"
                    style={{ height: item.size, width: tableWidth }}
                  >
                    {slot.month}
                  </div>
                );
              }
              const row = rowAt(slot.rowIndex);
              const isActive = active === slot.rowIndex;
              const isOpen = row && record === row.id;
              return (
                <div
                  data-reference={row?.reference || ""}
                  data-row-no={row ? String(row.rowNo) : ""}
                  data-txn-id={row?.id || ""}
                  className={cn(
                    "flex border-b border-border/70 text-sm transition-colors",
                    isActive || isOpen ? "bg-primary-subtle/50" : "hover:bg-muted/40",
                  )}
                  style={{ height: item.size, width: tableWidth }}
                >
                  {row ? (
                    visible.map((column) => (
                      <div
                        key={column.id}
                        className={cn(
                          "flex shrink-0 items-center truncate px-3 py-2",
                          column.align === "right" && "justify-end tabular-nums",
                          column.id === "select" && "px-2",
                          column.id === "reference" && "sticky left-0 z-10 bg-inherit",
                        )}
                        style={{ width: column.width }}
                      >
                        {renderCell(column.id, row)}
                      </div>
                    ))
                  ) : (
                    <span className="px-3 text-muted-foreground">Loading…</span>
                  )}
                </div>
              );
            }}
          />
        ) : null}
      </section>

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
    if (id === "select") {
      return (
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
      );
    }
    if (id === "reference") {
      return (
        <button
          type="button"
          className="truncate font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
          onClick={() => openRecord(row.id)}
        >
          {row.reference || `Row ${row.rowNo}`}
        </button>
      );
    }
    if (id === "date") {
      return <span className="tabular-nums text-muted-foreground">{formatDate(row.txnDate)}</span>;
    }
    if (id === "account") {
      return (
        <span className="inline-flex max-w-full items-center gap-1.5 truncate">
          <span className="truncate font-medium text-foreground">{row.accountLabel || "—"}</span>
          {row.currency ? (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {row.currency}
            </span>
          ) : null}
        </span>
      );
    }
    if (id === "currency") return row.currency || "AED";
    if (id === "description") {
      const text = row.descriptionClean || row.descriptionRaw;
      return (
        <span className="truncate text-foreground" dir="auto" title={text}>
          {text}
        </span>
      );
    }
    if (id === "counterparty") {
      return (
        <span dir="auto" className="truncate">
          {row.counterparty || ""}
        </span>
      );
    }
    if (id === "debit") return <Amount minor={row.debitMinor} />;
    if (id === "credit") return <Amount minor={row.creditMinor} />;
    if (id === "balance") return <Amount minor={row.balanceMinor} mutedEmpty />;
    if (id === "category") {
      return (
        <select
          className={cn(
            "h-8 w-full truncate rounded-md border border-transparent bg-transparent px-1 text-sm",
            "hover:border-input focus:border-input focus:bg-card",
            !row.categoryId && "text-muted-foreground",
          )}
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
          <option value="">Uncategorised</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      );
    }
    if (id === "classification") {
      const tone =
        row.classStatus === "classified" ? "ok" : row.classStatus === "unclassified" ? "warn" : "neutral";
      return <StatusPill tone={tone}>{row.classStatus.replaceAll("_", " ")}</StatusPill>;
    }
    if (id === "review") return row.reviewStatus.replaceAll("_", " ");
    if (id === "match") return "Unmatched";
    if (id === "flags") return row.flags.join(", ");
    if (id === "confidence") return row.confidence == null ? "" : `${Math.round(row.confidence * 100)}%`;
    return (
      <span className="truncate text-muted-foreground" title={row.statementLabel}>
        {row.statementLabel}
      </span>
    );
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

function Amount({ minor, mutedEmpty }: { minor: number | null; mutedEmpty?: boolean }) {
  const text = formatMinor(minor);
  if (!text) {
    return mutedEmpty ? <span className="text-muted-foreground/50">—</span> : null;
  }
  return <span className={cn("tabular-nums", text.startsWith("-") && "text-danger")}>{text}</span>;
}

function formatDate(value: string | null) {
  if (!value) return "";
  // Keep ISO YYYY-MM-DD — accountants sort/scan this reliably.
  return value.slice(0, 10);
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
