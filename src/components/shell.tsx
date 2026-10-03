"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  BookOpenText,
  ArrowLeftRight,
  FileSpreadsheet,
  Inbox,
  Landmark,
  Lock,
  Moon,
  PanelLeft,
  Receipt,
  Scale,
  ScrollText,
  Sun,
  Table2,
} from "lucide-react";

import { PRODUCT_NAME } from "@/config/product";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Directory = {
  me: { id: string; name: string; email: string; role: string } | null;
  users: { id: string; name: string; role: string }[];
  clients: { id: string; name: string }[];
  clientId: string;
};

const NAV = [
  { href: "/", label: "Clients", icon: Scale },
  { href: "/journals", label: "Journals", icon: Landmark },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/vat201", label: "VAT201", icon: Receipt },
  { href: "/reconcile", label: "Reconcile", icon: ArrowLeftRight },
  { href: "/close", label: "Close", icon: Lock },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/statements", label: "Bank stmts", icon: ScrollText },
  { href: "/transactions", label: "Transactions", icon: Table2 },
  { href: "/rules", label: "Rules", icon: BookOpenText },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.json())
      .then(setDirectory)
      .catch(() => setDirectory(null));
  }, [pathname]);

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
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            <Icon className="size-4 shrink-0" />
            {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className={`hidden shrink-0 border-r border-border bg-sidebar md:flex md:flex-col ${collapsed ? "w-16" : "w-60"}`}>
          <div className="flex items-center justify-between px-3 py-4">
            <Link href="/" className="font-heading text-xl tracking-tight">
              {collapsed ? "a" : PRODUCT_NAME}
            </Link>
            <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed((value) => !value)} aria-label="Collapse navigation">
              <PanelLeft />
            </Button>
          </div>
          <div className="px-2">{nav}</div>
          <div className="mt-auto space-y-3 p-3">
            <WorkingAs directory={directory} collapsed={collapsed} onSwitch={switchWorking} />
            <Button variant="outline" size="sm" className="w-full" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun /> : <Moon />}
              {collapsed ? null : theme === "dark" ? "Light" : "Dark"}
            </Button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-border px-3 py-3 md:hidden">
            <Button variant="outline" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <PanelLeft />
            </Button>
            <span className="font-heading text-lg">{PRODUCT_NAME}</span>
          </header>
          <main key={`${directory?.me?.id || ""}:${directory?.clientId || ""}`} className="min-w-0 flex-1 px-4 py-5 md:px-8">
            {children}
          </main>
        </div>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle className="font-heading">{PRODUCT_NAME}</SheetTitle>
          </SheetHeader>
          {nav}
          <div className="mt-6">
            <WorkingAs directory={directory} collapsed={false} onSwitch={switchWorking} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function WorkingAs({
  directory,
  collapsed,
  onSwitch,
}: {
  directory: Directory | null;
  collapsed: boolean;
  onSwitch: (userId: string, clientId: string) => void;
}) {
  if (!directory?.me || collapsed) return null;
  return (
    <div className="space-y-2 text-sm">
      <label className="block text-xs text-muted-foreground">
        Working as
        <select
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1"
          value={directory.me.id}
          onChange={(event) => {
            const user = directory.users.find((item) => item.id === event.target.value);
            if (!user) return;
            onSwitch(user.id, directory.clients[0]?.id || directory.clientId);
          }}
        >
          {directory.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · {user.role}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted-foreground">
        Client
        <select
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1"
          value={directory.clientId}
          onChange={(event) => onSwitch(directory.me!.id, event.target.value)}
        >
          {directory.clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
