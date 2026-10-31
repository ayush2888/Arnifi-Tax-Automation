export type Txn = {
  id: string;
  rowNo: number;
  reference: string | null;
  txnDate: string | null;
  valueDate: string | null;
  descriptionRaw: string;
  descriptionClean: string;
  counterparty: string | null;
  debitMinor: number | null;
  creditMinor: number | null;
  balanceMinor: number | null;
  currency: string;
  accountLabel?: string | null;
  categoryId: string | null;
  categoryName: string | null;
  classStatus: string;
  reviewStatus: string;
  flags: string[];
  confidence: number | null;
  statementId: string;
  statementLabel: string;
  sourcePage: number | null;
};

export type Category = { id: string; name: string };

export type ColumnId =
  | "select"
  | "reference"
  | "date"
  | "account"
  | "currency"
  | "description"
  | "counterparty"
  | "debit"
  | "credit"
  | "balance"
  | "category"
  | "classification"
  | "review"
  | "match"
  | "flags"
  | "confidence"
  | "statement";

export type Column = { id: ColumnId; label: string; width: number; visible: boolean; align: "left" | "right" };

/** Lean defaults — Account already implies currency; extras live under Columns. */
export const DEFAULT_COLUMNS: Column[] = [
  { id: "select", label: "", width: 40, visible: true, align: "left" },
  { id: "date", label: "Date", width: 108, visible: true, align: "left" },
  { id: "reference", label: "Reference", width: 132, visible: true, align: "left" },
  { id: "account", label: "Account", width: 128, visible: true, align: "left" },
  { id: "description", label: "Description", width: 280, visible: true, align: "left" },
  { id: "debit", label: "Debit", width: 112, visible: true, align: "right" },
  { id: "credit", label: "Credit", width: 112, visible: true, align: "right" },
  { id: "balance", label: "Balance", width: 120, visible: true, align: "right" },
  { id: "category", label: "Category", width: 148, visible: true, align: "left" },
  { id: "currency", label: "Currency", width: 72, visible: false, align: "left" },
  { id: "counterparty", label: "Counterparty", width: 160, visible: false, align: "left" },
  { id: "classification", label: "Classification", width: 130, visible: false, align: "left" },
  { id: "review", label: "Review", width: 120, visible: false, align: "left" },
  { id: "match", label: "Match", width: 110, visible: false, align: "left" },
  { id: "flags", label: "Flags", width: 160, visible: false, align: "left" },
  { id: "confidence", label: "Confidence", width: 110, visible: false, align: "right" },
  { id: "statement", label: "From statement", width: 220, visible: false, align: "left" },
];

export type Filters = {
  tab: string;
  q: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  categoryId: string;
  flag: string;
  sort: string;
  dir: string;
  groupByMonth: boolean;
};

export const EMPTY_FILTERS: Filters = {
  tab: "all",
  q: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  categoryId: "",
  flag: "",
  sort: "date",
  dir: "desc",
  groupByMonth: false,
};
