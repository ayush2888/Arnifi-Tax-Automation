"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { DEMO_USER_ID, PRODUCT_NAME } from "@/config/product";

function AutoEnter() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // No fixed client — session picks the first active (non-archived) company.
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: DEMO_USER_ID }),
        });
        if (!res.ok) {
          if (!cancelled) setError("Could not open workspace. Create a company from Home after login, or check the database.");
          // Still enter the app shell so Home can create a client if none remain.
          if (!cancelled) router.replace(next);
          return;
        }
        if (!cancelled) {
          router.replace(next);
          router.refresh();
        }
      } catch {
        if (!cancelled) setError("Could not open workspace. Is the database running?");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, next]);

  return (
    <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/80 bg-card p-8 shadow-sm">
      <div className="mb-2 inline-flex size-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-md shadow-primary/25">
        a
      </div>
      <h1 className="font-heading text-xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {error || "Opening workspace…"}
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--primary-subtle),_var(--background)_55%)] px-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Opening…</p>}>
        <AutoEnter />
      </Suspense>
    </div>
  );
}
