"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Parse dd/mm/yyyy (also accepts d/m/yyyy) → ISO yyyy-mm-dd, or null if incomplete/invalid. */
export function parseUaeDateInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yyyy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) {
    return null;
  }
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function isoToUaeDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const raw = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

type Props = {
  id?: string;
  value: string; // ISO yyyy-mm-dd
  onChange: (iso: string) => void;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
  "aria-label"?: string;
};

/** Text date control showing dd/mm/yyyy; stores ISO under the hood. */
export function BooksDateInput({
  id,
  value,
  onChange,
  className,
  disabled,
  "data-testid": testId,
  "aria-label": ariaLabel,
}: Props) {
  const [text, setText] = useState(() => isoToUaeDisplay(value));

  useEffect(() => {
    setText(isoToUaeDisplay(value));
  }, [value]);

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/yyyy"
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel || "Date"}
      className={cn("tabular-nums", className)}
      value={text}
      onChange={(e) => {
        const next = e.target.value.replace(/[^\d/]/g, "").slice(0, 10);
        setText(next);
        const parsed = parseUaeDateInput(next);
        if (parsed) onChange(parsed);
        if (!next.trim()) onChange("");
      }}
      onBlur={() => {
        const parsed = parseUaeDateInput(text);
        if (parsed) {
          onChange(parsed);
          setText(isoToUaeDisplay(parsed));
        } else if (!text.trim()) {
          onChange("");
          setText("");
        } else {
          setText(isoToUaeDisplay(value));
        }
      }}
    />
  );
}
