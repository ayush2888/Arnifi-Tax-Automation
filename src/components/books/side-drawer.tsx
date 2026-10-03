"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CellStatusPill, CellTypePill } from "@/components/books/cells";
import { cn } from "@/lib/utils";

export function BooksSideDrawer({
  open,
  onOpenChange,
  title,
  entryNo,
  status,
  source,
  entryType,
  tabs,
  activeTab,
  onTabChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  entryNo?: string | null;
  status?: string;
  source?: string;
  entryType?: string;
  tabs?: { id: string; label: string }[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        data-testid="books-side-drawer"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-1">
            <SheetTitle className="text-lg font-semibold">{entryNo || title}</SheetTitle>
            <p className="truncate text-sm text-muted-foreground">{title}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {status ? <CellStatusPill status={status} /> : null}
              {entryType ? <CellTypePill entryType={entryType} /> : null}
              {source ? (
                <span className="text-xs text-muted-foreground">
                  {source} · {entryType || "manual"}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            onClick={() => onOpenChange(false)}
            aria-label="Close drawer"
          >
            <X className="size-5" />
          </button>
        </div>
        {tabs && tabs.length > 0 ? (
          <div className="flex gap-1 border-b border-border px-5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "border-b-2 px-3 py-2.5 text-sm -mb-px",
                  activeTab === tab.id
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onTabChange?.(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
