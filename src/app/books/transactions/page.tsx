import { LedgerPageChrome } from "@/components/books/ledger-page-chrome";

export default function BooksTransactionsPage() {
  return (
    <LedgerPageChrome
      title="Ledger"
      subtitle="Bank and card transactions — matching to journals."
      transactionsEmpty
    >
      {null}
    </LedgerPageChrome>
  );
}
