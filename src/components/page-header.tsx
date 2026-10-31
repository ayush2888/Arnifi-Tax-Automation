import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "ab-hero-band flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="relative z-[1] min-w-0 space-y-2">
        <div className="inline-flex items-center gap-2">
          <span className="h-1.5 w-8 rounded-full bg-gradient-to-r from-primary to-[var(--brand-accent)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">arnibooks</span>
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground md:text-[1.85rem]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="relative z-[1] flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
