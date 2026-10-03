import { LedgerError } from "@/server/errors";

/** Books domain errors — same shape as LedgerError for API mapping. */
export class BooksError extends LedgerError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "BooksError";
  }
}

export { LedgerError };
