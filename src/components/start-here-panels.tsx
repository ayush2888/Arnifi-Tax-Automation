"use client";

import { useEffect, useState } from "react";

import DashboardPage from "@/app/dashboard/page";
import InboxPage from "@/app/inbox/page";
import StatementsPage from "@/app/statements/page";

const START_HERE = ["/dashboard", "/inbox", "/statements"] as const;
type StartHref = (typeof START_HERE)[number];

function isStartHere(pathname: string): pathname is StartHref {
  return (START_HERE as readonly string[]).includes(pathname);
}

/**
 * Keep Home / Inbox / Bank statements mounted after first visit.
 * Switching only toggles visibility — no remount, no API refetch waterfall.
 * That is the main nav lag on this app (each page remount was re-hitting ~0.6–1s APIs).
 */
export function StartHerePanels({ pathname }: { pathname: string }) {
  const active = isStartHere(pathname) ? pathname : null;
  const [mounted, setMounted] = useState<Partial<Record<StartHref, boolean>>>({});

  useEffect(() => {
    if (!active) return;
    setMounted((prev) => (prev[active] ? prev : { ...prev, [active]: true }));
  }, [active]);

  // Eagerly mount the other two after the first start-here visit so later clicks are instant.
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      setMounted({ "/dashboard": true, "/inbox": true, "/statements": true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!Object.values(mounted).some(Boolean)) return null;

  return (
    <>
      {mounted["/dashboard"] ? (
        <div
          hidden={active !== "/dashboard"}
          aria-hidden={active !== "/dashboard"}
          className={active === "/dashboard" ? undefined : "hidden"}
        >
          <DashboardPage />
        </div>
      ) : null}
      {mounted["/inbox"] ? (
        <div
          hidden={active !== "/inbox"}
          aria-hidden={active !== "/inbox"}
          className={active === "/inbox" ? undefined : "hidden"}
        >
          <InboxPage />
        </div>
      ) : null}
      {mounted["/statements"] ? (
        <div
          hidden={active !== "/statements"}
          aria-hidden={active !== "/statements"}
          className={active === "/statements" ? undefined : "hidden"}
        >
          <StatementsPage />
        </div>
      ) : null}
    </>
  );
}

export function isStartHerePath(pathname: string) {
  return isStartHere(pathname);
}
