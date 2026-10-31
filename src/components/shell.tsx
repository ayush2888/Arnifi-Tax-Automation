"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  FileSpreadsheet,
  Home,
  Inbox,
  Layers,
  Landmark,
  Lock,
  PanelLeft,
  Receipt,
  Scale,
  Upload,
} from "lucide-react";

import { BooksShellProvider, useBooksShell } from "@/components/books/books-shell-context";
import { SecurityBannerChip } from "@/components/security-banner";
import { isStartHerePath, StartHerePanels } from "@/components/start-here-panels";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DEMO_USER_ID, PRODUCT_NAME } from "@/config/product";
import { cn } from "@/lib/utils";

function roleLabel(role: string) {
  const key = role.toLowerCase();
  if (key === "accountant") return "Accountant";
  if (key === "admin" || key === "approver") return "Approver";
  if (key === "viewer") return "Viewer";
  return role;
}

type Directory = {
  me: { id: string; name: string; email: string; role: string } | null;
  users: { id: string; name: string; role: string }[];
  clients: { id: string; name: string }[];
  clientId: string;
};

const NAV_GROUPS: { title: string; items: { href: string; label: string; icon: typeof Upload }[] }[] = [
  {
    title: "Start here",
    items: [
      { href: "/dashboard", label: "Home", icon: Home },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/statements", label: "Bank statements", icon: Upload },
    ],
  },
  {
    title: "Bank",
    items: [
      { href: "/transactions", label: "Bank transactions", icon: ArrowLeftRight },
      { href: "/reconcile", label: "Reconcile", icon: Scale },
    ],
  },
  {
    title: "Accounting",
    items: [
      { href: "/journals", label: "Journals", icon: Landmark },
      { href: "/reports", label: "Reports", icon: FileSpreadsheet },
      { href: "/books/reports/subsidiary-ledgers", label: "Subsidiary ledgers", icon: BookOpen },
      { href: "/books/reports/group-ledgers", label: "Group overview", icon: Layers },
      { href: "/close", label: "Close period", icon: Lock },
    ],
  },
  {
    title: "Tax packs",
    items: [
      { href: "/vat201", label: "VAT", icon: Receipt },
      { href: "/ct", label: "Corporate tax", icon: FileSpreadsheet },
    ],
  },
];

/** Period belongs on month-scoped ledger/tax screens — not Inbox, Home, statements, or bank lines. */
const PERIOD_TOPBAR_PREFIXES = [
  "/journals",
  "/reconcile",
  "/reports",
  "/close",
  "/vat201",
  "/ct",
  "/books/journals",
  "/books/reports",
  "/books/close",
];

function showsTopBarPeriod(path: string) {
  return PERIOD_TOPBAR_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { periods, periodId, setPeriodId, reloadPeriods } = useBooksShell();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const booted = useRef(false);
  // Soft path for Home/Inbox/Bank — avoids Next soft-nav + remount + API refetch on every click.
  const [softPath, setSoftPath] = useState(pathname);

  useEffect(() => {
    setSoftPath(pathname);
  }, [pathname]);

  useEffect(() => {
    function onPop() {
      setSoftPath(window.location.pathname);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const isLogin = pathname === "/login";
  const activeClientName =
    directory?.clients.find((c) => c.id === directory.clientId)?.name ||
    (directory?.clients.length ? "Company" : "No company yet");
  const openPeriod = periods.find((p) => p.id === periodId) || periods[0];

  function goStartHere(href: string, event: MouseEvent) {
    if (!isStartHerePath(href)) return;
    event.preventDefault();
    setMobileOpen(false);
    if (softPath === href) return;
    window.history.pushState(null, "", href);
    setSoftPath(href);
  }

  // Boot session once — do NOT blank the shell on every route change (that caused the hang).
  useEffect(() => {
    if (isLogin) {
      setSessionReady(true);
      return;
    }
    if (booted.current && directory?.me) {
      setSessionReady(true);
      return;
    }

    let cancelled = false;

    async function ensureSession() {
      try {
        let response = await fetch("/api/session");
        if (!response.ok) {
          const boot = await fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: DEMO_USER_ID }),
          });
          if (!boot.ok) {
            if (!cancelled) setDirectory(null);
            return;
          }
          response = await fetch("/api/session");
        }
        if (!response.ok) {
          if (!cancelled) setDirectory(null);
          return;
        }
        const book = await response.json();
        if (!cancelled) {
          setDirectory(book);
          booted.current = true;
          // Warm the three daily routes so sidebar clicks feel instant.
          for (const href of ["/dashboard", "/inbox", "/statements"]) {
            void router.prefetch(href);
          }
        }
      } catch {
        if (!cancelled) setDirectory(null);
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }

    void ensureSession();
    return () => {
      cancelled = true;
    };
    // intentionally omit pathname — navigation must not re-boot session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLogin]);

  async function switchWorking(userId: string, clientId: string) {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, clientId }),
    });
    if (!response.ok) return;
    const next = await fetch("/api/session").then((item) => item.json());
    setDirectory(next);
    reloadPeriods();
    window.dispatchEvent(new Event("arnibooks:session"));
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-6 px-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="space-y-1">
          {!collapsed ? (
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)]">
              {group.title}
            </p>
          ) : null}
          {group.items.map((item) => {
            const active = softPath === item.href || softPath.startsWith(`${item.href}/`);
            const Icon = item.icon;
            const startHere = isStartHerePath(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={!startHere}
                onClick={(event) => {
                  if (startHere) {
                    goStartHere(item.href, event);
                    return;
                  }
                  setMobileOpen(false);
                }}
                title={item.label}
                className={cn(
                  "ab-nav-item group",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_0_var(--sidebar-primary)]"
                    : "text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-sidebar-foreground hover:translate-x-0.5",
                  collapsed && "justify-center px-2 hover:translate-x-0",
                )}
              >
                <Icon
                  className={cn(
                    "size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110",
                    active ? "text-sidebar-primary" : "text-[var(--sidebar-muted)] group-hover:text-sidebar-foreground",
                  )}
                />
                {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const roleTitle = directory?.me ? roleLabel(directory.me.role) : "";

  if (isLogin) {
    return <>{children}</>;
  }

  if (!sessionReady || !directory?.me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--primary-subtle),_var(--background)_60%)] text-sm text-muted-foreground">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-md">
          <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Opening workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foreground">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
            collapsed ? "w-[76px]" : "w-[268px]",
          )}
        >
          <div className={cn("flex items-center gap-2 px-4 py-5", collapsed && "justify-center px-2")}>
            <Link
              href="/dashboard"
              prefetch
              className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-sidebar-foreground transition-opacity hover:opacity-90"
              title={PRODUCT_NAME}
            >
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-sidebar-primary to-[var(--brand-accent)] text-sm font-bold text-white shadow-lg shadow-sidebar-primary/30">
                a
              </span>
              {collapsed ? (
                <span className="sr-only">{PRODUCT_NAME}</span>
              ) : (
                <span className="bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  {PRODUCT_NAME}
                </span>
              )}
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "text-[var(--sidebar-muted)] hover:bg-white/10 hover:text-sidebar-foreground",
                !collapsed && "ml-auto",
              )}
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            >
              <PanelLeft className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">{nav}</div>
          <div className="mt-auto space-y-3 border-t border-sidebar-border p-3">
            <WorkingAs
              directory={directory}
              clients={directory.clients}
              collapsed={collapsed}
              onSwitch={switchWorking}
            />
            {!collapsed && directory?.me ? (
              <div className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-2 text-xs ring-1 ring-white/10">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-sidebar-accent font-medium text-sidebar-primary">
                  {roleLabel(directory.me.role).slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-sidebar-foreground">{roleLabel(directory.me.role)}</div>
                  <div className="truncate text-[var(--sidebar-muted)]">Signed in</div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-border/80 bg-card/80 px-3 py-2 backdrop-blur-md md:hidden">
            <Button variant="outline" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <PanelLeft />
            </Button>
            <span className="font-semibold text-primary">{PRODUCT_NAME}</span>
          </header>

          <header
            className="sticky top-0 z-20 hidden items-center gap-3 border-b border-border/70 bg-card/75 px-4 py-3 backdrop-blur-xl md:flex"
            data-testid="app-top-bar"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-foreground">{activeClientName}</p>
              <p className="truncate text-xs text-muted-foreground">{roleTitle}</p>
            </div>
            {showsTopBarPeriod(softPath) && periods.length > 0 ? (
              <select
                className="h-9 shrink-0 rounded-xl border border-border bg-background/90 px-3 text-sm text-foreground shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={periodId || openPeriod?.id || ""}
                onChange={(e) => setPeriodId(e.target.value)}
                data-testid="topbar-period"
                aria-label="Period"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.status})
                  </option>
                ))}
              </select>
            ) : null}
            <div className="flex-1" />
            {directory?.me && (directory.users || []).length > 0 ? (
              <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="hidden lg:inline">Working as</span>
                <select
                  className="h-9 max-w-[14rem] rounded-xl border border-border bg-background/90 px-3 text-sm text-foreground shadow-sm transition-all hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={directory.me.id}
                  aria-label="Working as"
                  data-testid="topbar-user-switcher"
                  onChange={(e) =>
                    void switchWorking(e.target.value, directory.clientId || directory.clients[0]?.id || "")
                  }
                >
                  {(directory.users || [])
                    .filter((u) => ["admin", "accountant", "approver"].includes(String(u.role || "").toLowerCase()))
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} · {roleLabel(user.role)}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <div className="ml-auto shrink-0">
              <SecurityBannerChip />
            </div>
          </header>

          {/*
            Start-here routes stay mounted (StartHerePanels) so Home↔Inbox↔Bank is instant.
            Other routes still use Next children. Remount main only when company changes.
          */}
          <main
            key={directory?.clientId || "none"}
            className="ab-page-enter min-w-0 flex-1 px-4 py-6 md:px-6 lg:px-8"
          >
            <StartHerePanels pathname={softPath} />
            {isStartHerePath(softPath) ? null : children}
          </main>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar text-sidebar-foreground">
          <SheetHeader>
            <SheetTitle className="font-semibold text-sidebar-foreground">{PRODUCT_NAME}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">{nav}</div>
          <div className="mt-6">
            <WorkingAs
              directory={directory}
              clients={directory.clients}
              collapsed={false}
              onSwitch={switchWorking}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <BooksShellProvider>
      <ShellInner>{children}</ShellInner>
    </BooksShellProvider>
  );
}

function WorkingAs({
  directory,
  clients,
  collapsed,
  onSwitch,
}: {
  directory: Directory | null;
  clients: { id: string; name: string }[];
  collapsed: boolean;
  onSwitch: (userId: string, clientId: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  if (!directory?.me) return null;
  const value = clients.some((c) => c.id === directory.clientId)
    ? directory.clientId
    : clients[0]?.id || directory.clientId;
  const activeName = clients.find((c) => c.id === value)?.name || "Company";

  async function removeCompany() {
    if (!value) return;
    const ok = window.confirm(
      `Remove “${activeName}” from your workspace?\n\nIt will disappear from Bank statements and the company list. History stays in the database.`,
    );
    if (!ok) return;
    setRemoving(true);
    try {
      const response = await fetch(`/api/clients/${value}/archive`, { method: "POST" });
      if (!response.ok) {
        window.alert("Could not remove this company.");
        return;
      }
      window.location.assign("/dashboard");
    } finally {
      setRemoving(false);
    }
  }

  if (!clients.length) {
    return collapsed ? null : (
      <p className="rounded-xl bg-white/5 px-2.5 py-2 text-xs text-[var(--sidebar-muted)] ring-1 ring-white/10">
        No company yet — create one on Home.
      </p>
    );
  }

  const users = (directory.users || []).filter((u) =>
    ["admin", "accountant", "approver"].includes(String(u.role || "").toLowerCase()),
  );
  const meId = directory.me.id;

  if (collapsed) {
    return (
      <div className="space-y-1">
        <select
          className="w-full rounded-md border border-border bg-card p-1 text-[10px]"
          value={meId}
          title="Working as (role)"
          data-testid="books-user-switcher"
          onChange={(event) => onSwitch(event.target.value, value)}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {roleLabel(user.role).slice(0, 8)}
            </option>
          ))}
        </select>
        <select
          className="w-full rounded-md border border-border bg-card p-1 text-[10px]"
          value={value}
          title="Switch client"
          onChange={(event) => onSwitch(meId, event.target.value)}
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name.slice(0, 12)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <label className="block text-xs font-medium text-[var(--sidebar-muted)]">
        Working as
        <select
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-white/10"
          value={meId}
          onChange={(event) => onSwitch(event.target.value, value)}
          data-testid="books-user-switcher"
        >
          {users.map((user) => (
            <option key={user.id} value={user.id} className="bg-sidebar text-sidebar-foreground">
              {user.name} · {roleLabel(user.role)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-[var(--sidebar-muted)]">
        Company
        <select
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-white/10"
          value={value}
          onChange={(event) => onSwitch(meId, event.target.value)}
          data-testid="books-company-switcher"
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id} className="bg-sidebar text-sidebar-foreground">
              {client.name}
            </option>
          ))}
        </select>
      </label>
      {value ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-red-400/30 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200"
          disabled={removing}
          onClick={() => void removeCompany()}
        >
          {removing ? "Removing…" : "Remove company"}
        </Button>
      ) : null}
    </div>
  );
}
