"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Rule = {
  id: string;
  matchType: string;
  pattern: string;
  priority: number;
  active: boolean;
  categoryId: string;
  categoryName: string;
};

type Category = { id: string; name: string };

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ matchType: "contains", pattern: "", categoryId: "" });

  function load() {
    Promise.all([
      fetch("/api/rules").then((response) => response.json()),
      fetch("/api/categories").then((response) => response.json()),
      fetch("/api/session").then((response) => response.json()),
    ])
      .then(([list, cats, session]) => {
        setRules(list);
        setCategories(cats);
        setCanWrite(session.me?.role !== "viewer");
        setForm((current) => ({ ...current, categoryId: current.categoryId || cats[0]?.id || "" }));
      })
      .catch(() => setError("Could not load rules."));
  }

  useEffect(() => {
    load();
  }, []);

  async function createRule() {
    setError("");
    const response = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      setError("A rule needs a pattern and a category. Viewers cannot create rules.");
      return;
    }
    setForm({ ...form, pattern: "" });
    load();
  }

  async function disable(id: string) {
    const response = await fetch(`/api/rules/${id}/disable`, { method: "POST" });
    if (!response.ok) {
      setError("This rule could not be disabled.");
      return;
    }
    load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Rules</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Rules propose a category when a description matches. They never confirm a row, and they are created only when you click Save rule.
        </p>
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {canWrite ? (
        <form
          className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createRule();
          }}
        >
          <Label className="text-xs text-muted-foreground">
            Match
            <select className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground" value={form.matchType} onChange={(event) => setForm({ ...form, matchType: event.target.value })}>
              <option value="contains">contains</option>
              <option value="exact">exact</option>
              <option value="regex">regex</option>
            </select>
          </Label>
          <Label className="text-xs text-muted-foreground md:col-span-2">
            Pattern
            <Input dir="auto" className="mt-1" value={form.pattern} onChange={(event) => setForm({ ...form, pattern: event.target.value })} />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Category
            <select className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </Label>
          <div className="md:col-span-4">
            <Button type="submit">Save rule</Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">You can read the firm rules. Creating or disabling them needs an accountant or admin.</p>
      )}
      {!rules ? <p className="text-sm text-muted-foreground">Loading rules…</p> : null}
      {rules && rules.length === 0 ? <p className="text-sm text-muted-foreground">No rules yet.</p> : null}
      {rules && rules.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <p dir="auto">
                  <span className="font-medium">{rule.matchType}</span> “{rule.pattern}” → {rule.categoryName}
                </p>
                <p className="text-xs text-muted-foreground">Priority {rule.priority} · {rule.active ? "active" : "disabled"}</p>
              </div>
              {canWrite && rule.active ? (
                <Button variant="outline" size="sm" onClick={() => disable(rule.id)}>Disable</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
