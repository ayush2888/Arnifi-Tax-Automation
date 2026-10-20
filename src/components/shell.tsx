"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  FileSpreadsheet,
  Landmark,
  Lock,
  PanelLeft,
  Receipt,
  Scale,
  Search,
  Upload,
} from "lucide-react";

import { BooksShellProvider, useBooksShell } from "@/components/books/books-shell-context";
import { SecurityBannerChip } from "@/components/security-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BOOKS_CLIENT_ID_SET, PRODUCT_NAME } from "@/config/product";
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
    title: "Cash & ledger",
    items: [
      { href: "/transactions", label: "Bank", icon: ArrowLeftRight },
      { href: "/statements", label: "Statements", icon: Upload },
      { href: "/journals", label: "Ledger", icon: Landmark },
      { href: "/reconcile", label: "Reconcile", icon: Scale },
    ],
  },
  {
    title: "Close & tax",
    items: [
      { href: "/close", label: "Close", icon: Lock },
      { href: "/vat201", label: "VAT", icon: Receipt },
      { href: "/reports", label: "Reports", icon: FileSpreadsheet },
      { href: "/ct", label: "Corporate tax", icon: Activity },
    ],
  },
];

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { periods, periodId, setPeriodId, globalSearch, setGlobalSearch } = useBooksShell();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLogin = pathname === "/login";
  const isBooks = pathname.startsWith("/books");
  const showGlobalSearch = isBooks;

  const booksClients = useMemo(() => {
    const all = directory?.clients || [];
    return all.filter((c) => BOOKS_CLIENT_ID_SET.has(c.id));
  }, [directory?.clients]);

  const switcherClients = directory?.clients || [];
  const activeClientName =
    directory?.clients.find((c) => c.id === directory.clientId)?.name || "Company";

  useEffect(() => {
    if (isLogin) {
      setSessionReady(true);
      return;
    }
    setSessionReady(false);
    fetch("/api/session")
      .then(async (response) => {
        if (!response.ok) {
          setDirectory(null);
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        setDirectory(await response.json());
      })
      .catch(() => {
        setDirectory(null);
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      })
      .finally(() => setSessionReady(true));
  }, [pathname, router, isLogin]);

  // Books routes: never stay on a legacy client (e.g. Al Noor).
  useEffect(() => {
    if (isLogin || !isBooks || !directory?.me || booksClients.length === 0) return;
    if (BOOKS_CLIENT_ID_SET.has(directory.clientId)) return;
    const fallback = booksClients[0]!.id;
    void switchWorking(directory.me.id, fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBooks, directory?.clientId, directory?.me?.id, booksClients, isLogin]);

  async function switchWorking(userId: string, clientId: string) {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, clientId }),
    });
    if (!response.ok) return;
    router.refresh();
    const next = await fetch("/api/session").then((item) => item.json());
    setDirectory(next);
  }

  const nav = (
    <nav className="flex flex-col gap-5 px-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="space-y-1">
          {!collapsed ? (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {group.title}
            </p>
          ) : null}
          {group.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-subtle text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  collapsed && "justify-center px-2",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
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
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  if (isBooks && periods.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading company period…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex",
            collapsed ? "w-[72px]" : "w-[260px]",
          )}
        >
          <div className={cn("flex items-center gap-2 px-4 py-5", collapsed && "justify-center px-2")}>
            <Link
              href="/journals"
              className="flex items-center gap-2 text-lg font-semibold tracking-tight text-primary"
              title={PRODUCT_NAME}
            >
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                a
              </span>
              {collapsed ? <span className="sr-only">{PRODUCT_NAME}</span> : PRODUCT_NAME}
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(!collapsed && "ml-auto")}
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
              clients={switcherClients}
              collapsed={collapsed}
              onSwitch={switchWorking}
            />
            {!collapsed && directory?.me ? (
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-2 text-xs">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary-subtle font-medium text-primary">
                  {roleLabel(directory.me.role).slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{roleLabel(directory.me.role)}</div>
                  <div className="truncate text-muted-foreground">Demo session</div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 md:hidden">
            <Button variant="outline" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <PanelLeft />
            </Button>
            <span className="font-semibold text-primary">{PRODUCT_NAME}</span>
          </header>

          <header
            className="hidden items-center gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur md:flex"
            data-testid="app-top-bar"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                <span className="font-semibold">{roleTitle}</span>
                <span className="font-normal text-muted-foreground"> · demo</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">{activeClientName}</p>
            </div>
            {isBooks && periods.length > 0 ? (
              <select
                className="h-8 shrink-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={periodId}
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
            {showGlobalSearch ? (
              <div className="relative w-full max-w-[420px] flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-sm"
                  placeholder="Search ledger…"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                />
              </div>
            ) : (
              <div className="flex-1" />
            )}
            <div className="ml-auto shrink-0">
              <SecurityBannerChip />
            </div>
          </header>

          <main
            key={`${directory?.me?.id || ""}:${directory?.clientId || ""}`}
            className="min-w-0 flex-1 px-4 py-6 md:px-6 lg:px-8"
          >
            {children}
          </main>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle className="font-semibold text-primary">{PRODUCT_NAME}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">{nav}</div>
          <div className="mt-6">
            <WorkingAs
              directory={directory}
              clients={switcherClients}
              collapsed={false}
              onSwitch={switchWorking}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
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
  if (!directory?.me) return null;
  const value = clients.some((c) => c.id === directory.clientId)
    ? directory.clientId
    : clients[0]?.id || directory.clientId;

  if (collapsed) {
    return (
      <select
        className="w-full rounded-md border border-border bg-card p-1 text-[10px]"
        value={value}
        title="Switch client"
        onChange={(event) => onSwitch(directory.me!.id, event.target.value)}
      >
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name.slice(0, 12)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <label className="block text-xs font-medium text-muted-foreground">
        Company
        <select
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          value={value}
          onChange={(event) => onSwitch(directory.me!.id, event.target.value)}
          data-testid="books-company-switcher"
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        Role
        <select
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          value={directory.me.id}
          onChange={(event) => {
            const user = directory.users.find((item) => item.id === event.target.value);
            if (!user) return;
            onSwitch(user.id, value);
          }}
        >
          {directory.users.map((user) => (
            <option key={user.id} value={user.id}>
              {roleLabel(user.role)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
