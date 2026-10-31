import assert from "node:assert/strict";
import test from "node:test";

import {
  ageLines,
  agingCsv,
  buildStatement,
  isLedgerKind,
  LEDGER_KIND_META,
  LEDGER_KINDS,
  normalizePartyInput,
  signedBalance,
  statementCsv,
  summarizeAging,
  summarizeGroup,
  summarizeParties,
  summaryCsv,
  toCsv,
  type PartyMovementRow,
  type StatementLineInput,
} from "./subsidiary-ledger-core";

function line(partial: Partial<StatementLineInput>): StatementLineInput {
  return {
    entryId: "11111111-1111-4111-8111-111111111111",
    entryNo: "SV-2026-0001",
    entryDate: "2026-06-05",
    voucherType: "Sales",
    reference: "INV-1",
    memo: "Invoice",
    accountCode: "1210",
    accountName: "Trade receivables",
    debitMinor: 0,
    creditMinor: 0,
    ...partial,
  };
}

function row(partial: Partial<PartyMovementRow>): PartyMovementRow {
  return {
    partyId: "p1",
    partyName: "Acme",
    partyType: "customer",
    openingDebitMinor: 0,
    openingCreditMinor: 0,
    periodDebitMinor: 0,
    periodCreditMinor: 0,
    ...partial,
  };
}

test("every ledger kind has metadata and an account filter", () => {
  for (const kind of LEDGER_KINDS) {
    const meta = LEDGER_KIND_META[kind];
    assert.ok(meta.label && meta.partyLabel, kind);
    assert.ok(["debit", "credit"].includes(meta.normalBalance), kind);
    assert.ok("flag" in meta.accountFilter || meta.accountFilter.subTypes.length > 0, kind);
  }
  assert.equal(isLedgerKind("sales"), true);
  assert.equal(isLedgerKind("payroll"), false);
  assert.equal(isLedgerKind(undefined), false);
});

test("signedBalance follows the normal side and goes negative on the other side", () => {
  assert.equal(signedBalance(1000, 400, "debit"), 600);
  assert.equal(signedBalance(400, 1000, "debit"), -600);
  assert.equal(signedBalance(400, 1000, "credit"), 600);
  assert.equal(signedBalance(1000, 400, "credit"), -600);
});

test("buildStatement carries opening balance into a running balance", () => {
  const s = buildStatement(
    { debitMinor: 10_000, creditMinor: 2_000 },
    [
      line({ debitMinor: 5_250 }),
      line({ creditMinor: 8_000, voucherType: "Receipt", entryDate: "2026-06-10" }),
      line({ debitMinor: 1 }),
    ],
    "debit",
  );
  assert.equal(s.openingBalanceMinor, 8_000);
  assert.deepEqual(
    s.lines.map((l) => l.balanceMinor),
    [13_250, 5_250, 5_251],
  );
  assert.equal(s.totalDebitMinor, 5_251);
  assert.equal(s.totalCreditMinor, 8_000);
  assert.equal(s.closingBalanceMinor, 5_251);
});

test("buildStatement closing equals opening plus net movement on a credit-normal ledger", () => {
  const s = buildStatement(
    { debitMinor: 0, creditMinor: 50_000 },
    [line({ debitMinor: 20_000 }), line({ creditMinor: 5_000 })],
    "credit",
  );
  assert.equal(s.openingBalanceMinor, 50_000);
  assert.equal(s.closingBalanceMinor, 50_000 - 20_000 + 5_000);
});

test("buildStatement with no lines keeps the opening balance", () => {
  const s = buildStatement({ debitMinor: 700, creditMinor: 0 }, [], "debit");
  assert.equal(s.closingBalanceMinor, 700);
  assert.deepEqual(s.lines, []);
});

test("summarizeParties totals match the sum of party rows and hide zero parties", () => {
  const summary = summarizeParties(
    [
      row({ partyId: "p1", partyName: "Beta Trading", openingDebitMinor: 1_000, periodDebitMinor: 500 }),
      row({ partyId: "p2", partyName: "Acme", periodDebitMinor: 2_000, periodCreditMinor: 2_000 }),
      row({ partyId: "p3", partyName: "Dormant" }),
      row({ partyId: null, partyName: null, partyType: null, periodDebitMinor: 300 }),
    ],
    "debit",
  );
  assert.deepEqual(
    summary.parties.map((p) => p.partyName),
    ["Acme", "Beta Trading", "Unassigned"],
  );
  assert.equal(summary.totals.closingBalanceMinor, 0 + 1_500 + 300);
  assert.equal(
    summary.totals.closingBalanceMinor,
    summary.parties.reduce((acc, p) => acc + p.closingBalanceMinor, 0),
  );
  assert.equal(summary.totals.periodDebitMinor, 500 + 2_000 + 300);
});

test("a party fully settled in the period still shows its movements", () => {
  const summary = summarizeParties(
    [row({ openingDebitMinor: 900, periodCreditMinor: 900 })],
    "debit",
  );
  assert.equal(summary.parties.length, 1);
  assert.equal(summary.parties[0].closingBalanceMinor, 0);
});

test("includeZero keeps parties with no activity", () => {
  const summary = summarizeParties([row({ partyId: "p9", partyName: "Dormant" })], "debit", {
    includeZero: true,
  });
  assert.equal(summary.parties.length, 1);
});

test("an unnamed party id falls back to a label and unassigned sorts last", () => {
  const summary = summarizeParties(
    [
      row({ partyId: null, partyName: null, periodDebitMinor: 1 }),
      row({ partyId: "p1", partyName: null, periodDebitMinor: 1 }),
    ],
    "debit",
  );
  assert.equal(summary.parties[0].partyName, "Unnamed");
  assert.equal(summary.parties[1].partyName, "Unassigned");
});

test("CSV output neutralises formula prefixes and keeps amounts plain", () => {
  const csv = toCsv(["Name", "Amount"], [["=HYPERLINK(\"x\")", "1,234.50"], ["Plain, with comma", "-5.00"]]);
  const rows = csv.split("\r\n");
  assert.equal(rows[0], "Name,Amount");
  assert.ok(rows[1].startsWith("'=HYPERLINK") || rows[1].startsWith("\"'=HYPERLINK"));
  assert.ok(rows[1].endsWith('"1,234.50"'));
  assert.equal(rows[2], '"Plain, with comma",-5.00');
});

test("summary and statement CSV include totals rows", () => {
  const summary = summarizeParties([row({ periodDebitMinor: 12_345 })], "debit");
  const csv = summaryCsv("sales", summary);
  assert.ok(csv.startsWith("Customer,Opening,Debits,Credits,Closing"));
  assert.ok(csv.includes("Total"));
  assert.ok(csv.includes('"123.45"') || csv.includes("123.45"));

  const stmt = statementCsv(buildStatement({ debitMinor: 0, creditMinor: 0 }, [line({ debitMinor: 100 })], "debit"));
  assert.ok(stmt.includes("Opening balance"));
  assert.ok(stmt.includes("Closing balance"));
});

test("normalizePartyInput trims, validates and defaults optional fields", () => {
  const ok = normalizePartyInput({
    name: "  Al   Noor   Trading ",
    partyType: "customer",
    trn: "1000 1234 5678 901",
    email: " ap@alnoor.ae ",
  });
  assert.deepEqual(ok, {
    name: "Al Noor Trading",
    partyType: "customer",
    trn: "100012345678901",
    email: "ap@alnoor.ae",
  });
  const minimal = normalizePartyInput({ name: "Omar", partyType: "shareholder" });
  assert.equal(minimal.trn, null);
  assert.equal(minimal.email, null);
});

test("normalizePartyInput rejects bad input with stable codes", () => {
  const code = (raw: Parameters<typeof normalizePartyInput>[0]) => {
    try {
      normalizePartyInput(raw);
    } catch (error) {
      return (error as Error).message;
    }
    return "ok";
  };
  assert.equal(code({ name: "   ", partyType: "customer" }), "party_name_required");
  assert.equal(code({ name: "x".repeat(201), partyType: "customer" }), "party_name_too_long");
  assert.equal(code({ name: "A", partyType: "vendor" }), "party_type_invalid");
  assert.equal(code({ name: "A", partyType: "customer", trn: "12345" }), "party_trn_invalid");
  assert.equal(code({ name: "A", partyType: "customer", trn: "200012345678901" }), "party_trn_invalid");
  assert.equal(code({ name: "A", partyType: "customer", email: "nope" }), "party_email_invalid");
});

test("ageLines clears the oldest charges first and buckets the rest", () => {
  const aged = ageLines(
    [
      { date: "2026-01-01", debitMinor: 10_000, creditMinor: 0 },
      { date: "2026-04-10", debitMinor: 5_000, creditMinor: 0 },
      { date: "2026-06-20", debitMinor: 2_000, creditMinor: 0 },
      { date: "2026-05-01", debitMinor: 0, creditMinor: 11_000 },
      { date: "2026-07-31", debitMinor: 9_999, creditMinor: 0 },
    ],
    "2026-06-30",
    "debit",
  );
  // 11,000 clears the 10,000 invoice and 1,000 of the April one; the July line is after asOf.
  assert.deepEqual(aged.buckets, [2_000, 0, 4_000, 0]);
  assert.equal(aged.unappliedMinor, 0);
  assert.equal(aged.totalMinor, 6_000);
});

test("ageLines treats overpayment as unapplied and credit kinds symmetrically", () => {
  const aged = ageLines(
    [
      { date: "2026-06-01", debitMinor: 0, creditMinor: 3_000 },
      { date: "2026-06-10", debitMinor: 5_000, creditMinor: 0 },
    ],
    "2026-06-30",
    "credit",
  );
  assert.deepEqual(aged.buckets, [0, 0, 0, 0]);
  assert.equal(aged.unappliedMinor, 2_000);
  assert.equal(aged.totalMinor, -2_000);
  assert.deepEqual(ageLines([], "2026-06-30", "debit").buckets, [0, 0, 0, 0]);
});

test("ageLines puts 90+ day items in the last bucket at the boundaries", () => {
  const asOf = "2026-06-30";
  const aged = ageLines(
    [
      { date: "2026-05-31", debitMinor: 1, creditMinor: 0 }, // 30 days
      { date: "2026-05-30", debitMinor: 2, creditMinor: 0 }, // 31 days
      { date: "2026-04-01", debitMinor: 4, creditMinor: 0 }, // 90 days
      { date: "2026-03-31", debitMinor: 8, creditMinor: 0 }, // 91 days
    ],
    asOf,
    "debit",
  );
  assert.deepEqual(aged.buckets, [1, 2, 4, 8]);
});

test("summarizeAging drops settled parties, sorts by exposure and totals the buckets", () => {
  const aging = summarizeAging(
    [
      {
        partyId: "a",
        partyName: "Small",
        partyType: "customer",
        lines: [{ date: "2026-06-25", debitMinor: 100, creditMinor: 0 }],
      },
      {
        partyId: "b",
        partyName: "Big",
        partyType: "customer",
        lines: [{ date: "2026-01-02", debitMinor: 900, creditMinor: 0 }],
      },
      {
        partyId: "c",
        partyName: "Settled",
        partyType: "customer",
        lines: [
          { date: "2026-06-01", debitMinor: 50, creditMinor: 0 },
          { date: "2026-06-02", debitMinor: 0, creditMinor: 50 },
        ],
      },
    ],
    "2026-06-30",
    "debit",
  );
  assert.deepEqual(aging.parties.map((p) => p.partyName), ["Big", "Small"]);
  assert.deepEqual(aging.totals.buckets, [100, 0, 0, 900]);
  assert.equal(aging.totals.totalMinor, 1_000);
  assert.match(agingCsv(aging, "Customer"), /^Customer,0-30,31-60,61-90,90\+,Unapplied,Total/);
});

test("summarizeGroup signs each kind on its own normal side", () => {
  const group = summarizeGroup(
    [
      { id: "c2", name: "Beta LLC" },
      { id: "c1", name: "Alpha LLC" },
    ],
    [
      { clientId: "c1", clientName: "Alpha LLC", kind: "sales", debitMinor: 1_000, creditMinor: 400 },
      { clientId: "c1", clientName: "Alpha LLC", kind: "loans", debitMinor: 100, creditMinor: 5_000 },
      { clientId: "c2", clientName: "Beta LLC", kind: "sales", debitMinor: 200, creditMinor: 0 },
    ],
  );
  assert.deepEqual(group.companies.map((c) => c.clientName), ["Alpha LLC", "Beta LLC"]);
  assert.equal(group.companies[0].balances.sales, 600);
  assert.equal(group.companies[0].balances.loans, 4_900);
  assert.equal(group.totals.sales, 800);
  assert.equal(group.totals.capital, 0);
});
