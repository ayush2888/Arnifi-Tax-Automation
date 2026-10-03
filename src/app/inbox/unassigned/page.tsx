"use client";

import { useEffect, useState } from "react";

import { DEMO_CLIENT_ID, DEMO_PERIOD_ID } from "@/config/product";
import { Button } from "@/components/ui/button";

type InboxRow = {
  id: string;
  originalName: string;
  routingConfidence: number;
  detectedDocType: string | null;
  detectedClientId: string | null;
  duplicateOf: string | null;
};

export default function UnassignedInboxPage() {
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    fetch("/api/inbox/unassigned")
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError("Could not load unassigned inbox."));
  }

  useEffect(() => {
    load();
  }, []);

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setMessage("");
    for (const file of Array.from(files)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
      const contentBase64 = btoa(binary);
      const response = await fetch("/api/inbox/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          detectedMime: file.type || "application/octet-stream",
          contentBase64,
        }),
      });
      if (!response.ok) {
        setError(`Upload failed for ${file.name}`);
        return;
      }
    }
    setMessage(`Uploaded ${files.length} file(s) to firm inbox.`);
    load();
  }

  async function routeToDemo(inboxId: string, docType?: string | null) {
    setError("");
    const response = await fetch("/api/inbox/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inboxId,
        clientId: DEMO_CLIENT_ID,
        periodId: DEMO_PERIOD_ID,
        docType: docType || "OTHER",
      }),
    });
    if (!response.ok) {
      setError("Routing failed.");
      return;
    }
    setMessage("Routed to Al Noor / Q1 2026.");
    load();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Unassigned inbox</h1>
        <p className="text-sm text-muted-foreground">
          Firm-level uploads wait here until client and period are confirmed. Nothing auto-posts.
        </p>
      </header>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <span className="rounded border px-3 py-2">Upload files</span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm">
            <div>
              <div className="font-medium">{row.originalName}</div>
              <div className="text-muted-foreground">
                {row.detectedDocType || "OTHER"} · confidence {row.routingConfidence}
                {row.duplicateOf ? " · duplicate" : ""}
              </div>
            </div>
            <Button type="button" size="sm" onClick={() => routeToDemo(row.id, row.detectedDocType)}>
              Route to Al Noor Q1
            </Button>
          </li>
        ))}
        {!rows.length ? <li className="text-sm text-muted-foreground">No pending files.</li> : null}
      </ul>
    </div>
  );
}
