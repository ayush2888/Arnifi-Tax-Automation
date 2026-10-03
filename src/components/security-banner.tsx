"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Security = {
  portalSecurityStatus: "FAIL" | "PASS";
  requireDownloadMfa: boolean;
  note: string;
};

export function SecurityBanner() {
  const [security, setSecurity] = useState<Security | null>(null);
  const [code, setCode] = useState("000000");
  const [mfaMsg, setMfaMsg] = useState("");

  useEffect(() => {
    fetch("/api/security-status")
      .then((r) => r.json())
      .then(setSecurity)
      .catch(() => setSecurity(null));
  }, []);

  async function verifyMfa() {
    setMfaMsg("");
    const response = await fetch("/api/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      setMfaMsg("MFA code rejected.");
      return;
    }
    setMfaMsg("Step-up MFA ok for pack downloads (short-lived).");
  }

  if (!security) return null;

  return (
    <div className="mb-4 space-y-2 border border-border bg-muted/40 px-3 py-2 text-sm">
      <p>
        Portal security: <strong>{security.portalSecurityStatus}</strong> — {security.note}
      </p>
      {security.requireDownloadMfa ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="h-8 w-28"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="MFA demo code"
          />
          <Button size="sm" variant="outline" onClick={verifyMfa}>
            Verify download MFA
          </Button>
          {mfaMsg ? <span className="text-muted-foreground">{mfaMsg}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
