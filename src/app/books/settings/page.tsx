"use client";

import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useBooksShell } from "@/components/books/books-shell-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateUae } from "@/lib/date";
import { formatMinor } from "@/lib/money";
import { statementLineLabel } from "@/lib/statement-line";

type Profile = { id: string; name: string; trn: string | null; defaultCurrency: string };
type Period = { id: string; label: string; periodStart: string; periodEnd: string; status: string };
type UserRow = { id: string; name: string; email: string; role: string };
type CoaNode = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  isPostable: boolean;
  normalBalance: string | null;
  statementLine: string | null;
  defaultVatCode: string | null;
  balanceMinor: number;
  active: boolean;
  children: CoaNode[];
};

function flattenCoa(nodes: CoaNode[], depth = 0, out: Array<CoaNode & { depth: number }> = []) {
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children?.length) flattenCoa(n.children, depth + 1, out);
  }
  return out;
}

function CoaSection({ periodId }: { periodId: string }) {
  const [tree, setTree] = useState<CoaNode[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [editNode, setEditNode] = useState<CoaNode | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addParent, setAddParent] = useState<CoaNode | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    accountType: "expense",
    normalBalance: "debit",
    statementLine: "",
    defaultVatCode: "",
  });

  const reload = useCallback(async () => {
    const qs = periodId ? `?periodId=${periodId}` : "";
    const t = await fetch(`/api/books/coa${qs}`).then((r) => r.json());
    if (Array.isArray(t)) setTree(t);
  }, [periodId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flat = useMemo(() => flattenCoa(tree), [tree]);
  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return flat;
    const codes = new Set(flat.filter((n) => `${n.code} ${n.name}`.toLowerCase().includes(q)).map((n) => n.id));
    return flat.filter((n) => codes.has(n.id));
  }, [flat, q]);

  function toggle(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function isHiddenByCollapse(node: CoaNode & { depth: number }) {
    let parent = flat.find((x) => x.children?.some((c) => c.id === node.id));
    while (parent) {
      if (collapsed[parent.id]) return true;
      parent = flat.find((x) => x.children?.some((c) => c.id === parent!.id));
    }
    return false;
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium">Chart of accounts</h2>
          <p className="text-sm text-muted-foreground">UAE SME template (COA v2). Headers are non-postable.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAddParent(null);
            setForm({
              code: "",
              name: "",
              accountType: "expense",
              normalBalance: "debit",
              statementLine: "",
              defaultVatCode: "",
            });
            setAddOpen(true);
          }}
        >
          <Plus className="size-4" />
          Add root account
        </Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9 h-9" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="overflow-auto max-h-[480px] rounded-md border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 bg-muted/95 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">Code</th>
              <th className="px-2 py-2 text-left">Name</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Normal</th>
              <th className="px-2 py-2">Statement</th>
              <th className="px-2 py-2">VAT</th>
              <th className="px-2 py-2 text-right">Balance</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((node) => {
              if (!q && isHiddenByCollapse(node)) return null;
              const hasChildren = node.children.length > 0;
              return (
                <tr key={node.id} className={!node.active ? "opacity-50" : undefined}>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    <div className="flex items-center gap-1" style={{ paddingLeft: node.depth * 12 }}>
                      {hasChildren ? (
                        <button type="button" onClick={() => toggle(node.id)} aria-label="Expand">
                          {collapsed[node.id] ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                      ) : (
                        <span className="w-4" />
                      )}
                      {node.code}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">{node.name}</td>
                  <td className="px-2 py-1.5 capitalize text-xs">{node.accountType}</td>
                  <td className="px-2 py-1.5 text-xs capitalize">{node.normalBalance || "—"}</td>
                  <td className="px-2 py-1.5 text-xs" title={node.statementLine || undefined}>
                    {statementLineLabel(node.statementLine)}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{node.defaultVatCode || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs">
                    {formatMinor(Math.abs(node.balanceMinor))}
                    {!node.isPostable ? (
                      <span className="ml-1 text-[10px] text-muted-foreground">(rollup)</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{node.active ? "Active" : "Inactive"}</td>
                  <td className="px-2 py-1.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button size="sm" variant="ghost" className="h-7 w-7 px-0" aria-label="Row actions" />}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setAddParent(node);
                            setForm({
                              code: "",
                              name: "",
                              accountType: node.accountType,
                              normalBalance: node.normalBalance || "debit",
                              statementLine: node.statementLine || "",
                              defaultVatCode: "",
                            });
                            setAddOpen(true);
                          }}
                        >
                          Add child
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditNode(node)}>Edit</DropdownMenuItem>
                        {node.active ? (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={async () => {
                              const res = await fetch(`/api/books/accounts/${node.id}/deactivate`, {
                                method: "POST",
                                body: "{}",
                              });
                              if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                toast.error(err.error || "Cannot deactivate");
                                return;
                              }
                              toast.success("Account deactivated");
                              void reload();
                            }}
                          >
                            Deactivate
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(editNode)} onOpenChange={(o) => !o && setEditNode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editNode?.code}</DialogTitle>
          </DialogHeader>
          {editNode ? (
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  defaultValue={editNode.name}
                  id="edit-name"
                  onChange={(e) => setEditNode({ ...editNode, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Statement line</Label>
                <Input
                  defaultValue={editNode.statementLine || ""}
                  onChange={(e) => setEditNode({ ...editNode, statementLine: e.target.value })}
                />
              </div>
              <div>
                <Label>Default VAT</Label>
                <Input
                  defaultValue={editNode.defaultVatCode || ""}
                  onChange={(e) => setEditNode({ ...editNode, defaultVatCode: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!editNode) return;
                await fetch(`/api/books/accounts/${editNode.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: editNode.name,
                    statementLine: editNode.statementLine,
                    defaultVatCode: editNode.defaultVatCode || null,
                  }),
                });
                setEditNode(null);
                void reload();
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setAddParent(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{addParent ? `Add child under ${addParent.code}` : "Add root account"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Type</Label>
              <select
                className="h-9 w-full rounded-md border border-border px-2 text-sm"
                value={form.accountType}
                onChange={(e) => setForm({ ...form, accountType: e.target.value })}
              >
                {["asset", "liability", "equity", "income", "expense"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Normal balance</Label>
              <select
                className="h-9 w-full rounded-md border border-border px-2 text-sm"
                value={form.normalBalance}
                onChange={(e) => setForm({ ...form, normalBalance: e.target.value })}
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                await fetch("/api/books/accounts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ...form,
                    parentId: addParent?.id ?? null,
                    isPostable: true,
                  }),
                });
                setAddOpen(false);
                setAddParent(null);
                void reload();
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type VoucherSeq = { voucherType: string; year: number; prefix: string; lastN: number };

export default function BooksSettingsPage() {
  const { periodId } = useBooksShell();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sequences, setSequences] = useState<VoucherSeq[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("accountant");
  const [name, setName] = useState("");
  const [trn, setTrn] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function reload() {
    const [p, per, u, seq] = await Promise.all([
      fetch("/api/books/company").then((r) => r.json()),
      fetch("/api/books/periods").then((r) => r.json()),
      fetch("/api/books/users").then((r) => r.json()),
      fetch("/api/books/voucher-sequences").then((r) => r.json()),
    ]);
    if (p?.id) {
      setProfile(p);
      setName(p.name || "");
      setTrn(p.trn || "");
    }
    if (Array.isArray(per)) setPeriods(per);
    if (Array.isArray(u)) setUsers(u);
    if (Array.isArray(seq)) setSequences(seq);
  }

  useEffect(() => {
    reload().catch(() => setError("Could not load settings."));
  }, []);

  async function saveProfile() {
    setError("");
    setSaved("");
    const res = await fetch("/api/books/company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, trn: trn || null }),
    });
    if (!res.ok) {
      setError("Profile save failed.");
      return;
    }
    setSaved("Company profile saved.");
    await reload();
  }

  async function lockPeriod(id: string) {
    await fetch(`/api/books/periods/${id}/lock`, { method: "POST", body: "{}" });
    await reload();
  }

  async function unlockPeriod(id: string) {
    await fetch(`/api/books/periods/${id}/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Settings unlock" }),
    });
    await reload();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Company profile, chart of accounts, periods, and users.</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {saved ? <p className="text-sm text-status-ok">{saved}</p> : null}

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-medium">Company profile</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="co-name">Legal name</Label>
            <Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="co-trn">TRN</Label>
            <Input id="co-trn" value={trn} onChange={(e) => setTrn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Default currency</Label>
            <Input value={profile?.defaultCurrency || "AED"} disabled />
          </div>
        </div>
        <Button onClick={saveProfile}>Save profile</Button>
      </section>

      <CoaSection periodId={periodId} />

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-medium">Periods</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2">Label</th>
              <th>Range</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="py-2 font-medium">{p.label}</td>
                <td>
                  {formatDateUae(p.periodStart)} → {formatDateUae(p.periodEnd)}
                </td>
                <td>{p.status}</td>
                <td className="space-x-2 text-right">
                  {p.status === "LOCKED" ? (
                    <Button size="sm" variant="outline" onClick={() => unlockPeriod(p.id)}>
                      Unlock
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => lockPeriod(p.id)}>
                      Lock
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-medium">Users & roles</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="py-2">{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    className="h-8 rounded-md border border-border px-2 text-sm capitalize"
                    value={u.role}
                    data-testid={`user-role-${u.id}`}
                    onChange={async (e) => {
                      await fetch(`/api/books/users/${u.id}/role`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ role: e.target.value }),
                      });
                      await reload();
                    }}
                  >
                    <option value="admin">admin</option>
                    <option value="accountant">accountant</option>
                    <option value="approver">approver</option>
                    <option value="viewer">viewer</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div>
            <Label>Invite email</Label>
            <Input
              className="mt-1"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@firm.test"
              data-testid="invite-email"
            />
          </div>
          <div>
            <Label>Role</Label>
            <select
              className="mt-1 h-9 rounded-md border border-border px-2 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="accountant">accountant</option>
              <option value="approver">approver</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              const res = await fetch("/api/books/invites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "invite_failed");
                return;
              }
              setSaved(`Invite stub created for ${inviteEmail} (delivery in a later phase).`);
              setInviteEmail("");
            }}
          >
            Invite
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-medium">Numbering</h2>
        <p className="text-sm text-muted-foreground">
          Voucher number series for the current calendar year (prefix + last used sequence).
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2">Voucher type</th>
              <th>Prefix</th>
              <th>Last N</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sequences.map((s) => (
              <tr key={s.voucherType} className="border-t border-border">
                <td className="py-2">{s.voucherType}</td>
                <td>
                  <Input
                    className="h-8 w-24"
                    defaultValue={s.prefix}
                    id={`prefix-${s.voucherType}`}
                  />
                </td>
                <td>
                  <Input
                    className="h-8 w-24"
                    type="number"
                    defaultValue={s.lastN}
                    id={`lastn-${s.voucherType}`}
                  />
                </td>
                <td className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const prefix = (
                        document.getElementById(`prefix-${s.voucherType}`) as HTMLInputElement
                      )?.value;
                      const lastN = Number(
                        (document.getElementById(`lastn-${s.voucherType}`) as HTMLInputElement)
                          ?.value,
                      );
                      await fetch("/api/books/voucher-sequences", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          voucherType: s.voucherType,
                          prefix,
                          lastN,
                        }),
                      });
                      await reload();
                    }}
                  >
                    Save
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
