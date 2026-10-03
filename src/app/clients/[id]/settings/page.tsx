"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type Profile = {
  legalName: string;
  trn: string | null;
  baseCurrency: string;
  fyStartMonth: number;
  vatRegistered: boolean;
  vatPeriod: string;
  ctApplicable: boolean;
};

type Source = { id: string; kind: string; label: string; currency: string; active: boolean };
type Rule = {
  id: string;
  clientId: string | null;
  docType: string | null;
  lineFlag: string;
  targetAccountCode: string | null;
  priority: number;
};
type Fx = { id: string; rateDate: string; currency: string; rateToAedScaled: number };

export default function ClientSettingsPage() {
  const params = useParams<{ id: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [fx, setFx] = useState<Fx[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function load() {
    Promise.all([
      fetch("/api/client-profile").then((r) => r.json()),
      fetch("/api/source-accounts").then((r) => r.json()),
      fetch("/api/posting-rules").then((r) => r.json()),
      fetch("/api/fx-rates").then((r) => r.json()),
    ])
      .then(([p, s, r, f]) => {
        setProfile(p);
        setSources(Array.isArray(s) ? s : []);
        setRules(Array.isArray(r) ? r : []);
        setFx(Array.isArray(f) ? f : []);
      })
      .catch(() => setError("Could not load client settings."));
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function saveProfile() {
    if (!profile) return;
    setError("");
    setMessage("");
    const response = await fetch("/api/client-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!response.ok) {
      setError("Save failed.");
      return;
    }
    setMessage("Profile saved.");
    load();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <header>
        <p className="text-sm text-muted-foreground">Client settings</p>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline config</h1>
        <p className="text-sm text-muted-foreground">
          Profile, source accounts, posting rules, and FX rates for this synthetic tenant.
        </p>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Profile</h2>
        {profile ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Legal name
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={profile.legalName}
                onChange={(e) => setProfile({ ...profile, legalName: e.target.value })}
              />
            </label>
            <label className="text-sm">
              TRN
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={profile.trn || ""}
                onChange={(e) => setProfile({ ...profile, trn: e.target.value || null })}
              />
            </label>
            <label className="text-sm">
              VAT period
              <select
                className="mt-1 w-full rounded border px-2 py-1"
                value={profile.vatPeriod}
                onChange={(e) => setProfile({ ...profile, vatPeriod: e.target.value })}
              >
                <option value="monthly">monthly</option>
                <option value="quarterly">quarterly</option>
              </select>
            </label>
            <label className="text-sm">
              FY start month
              <input
                type="number"
                min={1}
                max={12}
                className="mt-1 w-full rounded border px-2 py-1"
                value={profile.fyStartMonth}
                onChange={(e) => setProfile({ ...profile, fyStartMonth: Number(e.target.value) })}
              />
            </label>
            <div className="sm:col-span-2">
              <Button type="button" onClick={saveProfile}>
                Save profile
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No profile for session client.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Source accounts</h2>
        <ul className="space-y-1 text-sm">
          {sources.map((s) => (
            <li key={s.id}>
              [{s.kind}] {s.label} · {s.currency} {s.active ? "" : "(inactive)"}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Posting rules</h2>
        <ul className="space-y-1 text-sm">
          {rules.map((r) => (
            <li key={r.id}>
              p{r.priority} {r.clientId ? "client" : "global"} · {r.docType || "*"} · {r.lineFlag} →{" "}
              {r.targetAccountCode || "—"}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">FX rates</h2>
        <ul className="space-y-1 text-sm">
          {fx.map((row) => (
            <li key={row.id}>
              {row.rateDate} {row.currency} → AED scaled {row.rateToAedScaled}
            </li>
          ))}
          {!fx.length ? <li className="text-muted-foreground">No rates yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
