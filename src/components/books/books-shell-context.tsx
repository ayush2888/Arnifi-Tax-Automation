"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type BooksPeriod = { id: string; label: string; status: string };

type BooksShellContextValue = {
  periods: BooksPeriod[];
  periodId: string;
  setPeriodId: (id: string) => void;
  globalSearch: string;
  setGlobalSearch: (q: string) => void;
};

const BooksShellContext = createContext<BooksShellContextValue | null>(null);

export function BooksShellProvider({ children }: { children: ReactNode }) {
  const [periods, setPeriods] = useState<BooksPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");

  useEffect(() => {
    fetch("/api/books/periods")
      .then(async (r) => {
        if (!r.ok) return;
        const list = await r.json();
        if (!Array.isArray(list)) return;
        setPeriods(list);
        if (!periodId && list.length) {
          const jun = list.find((p: BooksPeriod) => /Jun\s*2026/i.test(p.label));
          const open = list.find((p: BooksPeriod) => p.status === "OPEN" || p.status === "REOPENED");
          setPeriodId(jun?.id || open?.id || list[0].id);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ periods, periodId, setPeriodId, globalSearch, setGlobalSearch }),
    [periods, periodId, globalSearch],
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
    };
  }
  return ctx;
}
