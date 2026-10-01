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
  | "reference"
  | "date"
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

export const DEFAULT_COLUMNS: Column[] = [
  { id: "reference", label: "Reference", width: 148, visible: true, align: "left" },
  { id: "date", label: "Date", width: 112, visible: true, align: "left" },
  { id: "description", label: "Description", width: 240, visible: true, align: "left" },
  { id: "counterparty", label: "Counterparty", width: 160, visible: true, align: "left" },
  { id: "debit", label: "Debit", width: 110, visible: true, align: "right" },
  { id: "credit", label: "Credit", width: 110, visible: true, align: "right" },
  { id: "balance", label: "Balance", width: 120, visible: true, align: "right" },
  { id: "category", label: "Category", width: 160, visible: true, align: "left" },
  { id: "classification", label: "Classification", width: 130, visible: true, align: "left" },
  { id: "review", label: "Review", width: 120, visible: true, align: "left" },
  { id: "match", label: "Match", width: 110, visible: true, align: "left" },
  { id: "flags", label: "Flags", width: 160, visible: true, align: "left" },
  { id: "confidence", label: "Confidence", width: 110, visible: true, align: "right" },
  { id: "statement", label: "Statement", width: 180, visible: true, align: "left" },
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
