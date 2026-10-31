"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { pickDefaultPeriodId } from "@/lib/period-default";

export type BooksPeriod = { id: string; label: string; status: string; periodStart?: string; periodEnd?: string };

type BooksShellContextValue = {
  periods: BooksPeriod[];
  periodId: string;
  setPeriodId: (id: string) => void;
  globalSearch: string;
  setGlobalSearch: (q: string) => void;
  reloadPeriods: () => void;
  clientId: string;
};

const BooksShellContext = createContext<BooksShellContextValue | null>(null);

export function BooksShellProvider({ children }: { children: ReactNode }) {
  const [periods, setPeriods] = useState<BooksPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((book) => {
        if (cancelled || !book) return;
        const nextClient = String(book.clientId || "");
        setClientId((prev) => {
          if (nextClient && nextClient !== prev) {
            setPeriodId("");
            return nextClient;
          }
          return prev || nextClient;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (!clientId) {
      setPeriods([]);
      setPeriodId("");
      return;
    }
    let cancelled = false;
    fetch("/api/periods")
      .then(async (r) => {
        if (!r.ok) return;
        const list = await r.json();
        if (cancelled || !Array.isArray(list)) return;
        setPeriods(list);
        setPeriodId((current) => {
          if (current && list.some((p: BooksPeriod) => p.id === current)) return current;
          return pickDefaultPeriodId(list);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clientId, tick]);

  const reloadPeriods = useCallback(() => setTick((n) => n + 1), []);

  const value = useMemo(
    () => ({
      periods,
      periodId,
      setPeriodId,
      globalSearch,
      setGlobalSearch,
      reloadPeriods,
      clientId,
    }),
    [periods, periodId, globalSearch, reloadPeriods, clientId],
  );

  return <BooksShellContext.Provider value={value}>{children}</BooksShellContext.Provider>;
}

export function useBooksShell() {
  const ctx = useContext(BooksShellContext);
  if (!ctx) {
    return {
      periods: [] as BooksPeriod[],
      periodId: "",
      setPeriodId: () => undefined,
      globalSearch: "",
      setGlobalSearch: () => undefined,
      reloadPeriods: () => undefined,
      clientId: "",
    };
  }
  return ctx;
}
