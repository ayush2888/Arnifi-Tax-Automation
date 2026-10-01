import { Suspense } from "react";

import { Workspace } from "@/components/transactions/workspace";

export default function TransactionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading transactions…</p>}>
      <Workspace />
    </Suspense>
  );
}
