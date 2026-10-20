"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { AL_NOOR_CLIENT_ID, PRODUCT_NAME } from "@/config/product";

const DEMO_USER = "55555555-5555-4555-8555-555555555555";
const DEMO_CLIENT = AL_NOOR_CLIENT_ID;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/journals";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: DEMO_USER, clientId: DEMO_CLIENT }),
      });
      if (!res.ok) {
        setError("Could not start demo session");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not start demo session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/80 bg-card p-8 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/70 to-brand-accent" />
      <div className="mb-8 space-y-3">
        <div className="inline-flex size-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
          a
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{PRODUCT_NAME}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Demo workspace for bank statements, journals, VAT packs, and reports. Synthetic companies only — no real
          client files until security review passes.
        </p>
      </div>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Starts as <span className="font-medium text-foreground">Accountant</span> on{" "}
          <span className="font-medium text-foreground">Al Noor Trading LLC</span>. Switch role in the sidebar to
          approve packs.
        </div>
        <Button className="h-10 w-full" disabled={busy} onClick={() => void signIn()} data-testid="login-submit">
          {busy ? "Opening…" : "Enter demo"}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--primary-subtle),_transparent_55%),linear-gradient(180deg,_#eef2ff_0%,_var(--background)_45%,_#f8fafc_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-24 size-72 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-16 size-64 rounded-full bg-brand-accent/10 blur-3xl"
      />
      <Suspense fallback={<p className="relative text-sm text-muted-foreground">Loading…</p>}>
        <div className="relative">
          <LoginForm />
        </div>
      </Suspense>
    </div>
  );
}
