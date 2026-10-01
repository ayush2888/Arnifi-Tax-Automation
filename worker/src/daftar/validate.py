"""Deterministic statement checks. Numbers are never rewritten to force a pass."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class Txn:
    row_no: int
    txn_date: date | None
    value_date: date | None
    description_raw: str
    description_clean: str
    counterparty: str | None
    reference: str | None
    debit_minor: int | None
    credit_minor: int | None
    balance_minor: int | None
    flags: list[str] = field(default_factory=list)
    confidence: float | None = None
    source_page: int | None = None
    source_bbox: dict | None = None
    bad_amount: bool = False


LOW_CONFIDENCE = 0.5


def _dedupe(flags: list[str]) -> list[str]:
    seen: list[str] = []
    for flag in flags:
        if flag not in seen:
            seen.append(flag)
    return seen


def apply_validation(
    txns: list[Txn],
    *,
    opening_minor: int | None,
    closing_minor: int | None,
    period_start: date | None,
    period_end: date | None,
    extracted_count: int,
    allow_both_sides: bool = False,
) -> list[str]:
    statement_flags: list[str] = []
    prev_balance = opening_minor
    prev_date: date | None = None
    amounts_incomplete = False

    for txn in txns:
        if txn.bad_amount:
            txn.flags.append("bad_amount")
            amounts_incomplete = True
        if txn.debit_minor is not None and txn.debit_minor < 0:
            txn.flags.append("negative_amount")
        if txn.credit_minor is not None and txn.credit_minor < 0:
            txn.flags.append("negative_amount")

        debit_populated = txn.debit_minor not in (None, 0)
        credit_populated = txn.credit_minor not in (None, 0)
        if debit_populated and credit_populated and not allow_both_sides:
            txn.flags.append("both_sides")

        if txn.txn_date is None and txn.description_raw and not txn.bad_amount:
            txn.flags.append("bad_date")
        if txn.txn_date is not None:
            if period_start and txn.txn_date < period_start:
                txn.flags.append("date_outside_period")
            if period_end and txn.txn_date > period_end:
                txn.flags.append("date_outside_period")
            if prev_date and txn.txn_date < prev_date:
                txn.flags.append("date_order")
            prev_date = txn.txn_date

        if txn.confidence is not None and txn.confidence < LOW_CONFIDENCE:
            txn.flags.append("low_confidence")

        if txn.balance_minor is None or prev_balance is None:
            if txn.balance_minor is None:
                txn.flags.append("missing_balance")
            if txn.balance_minor is not None:
                prev_balance = txn.balance_minor
            txn.flags = _dedupe(txn.flags)
            continue

        if txn.bad_amount or (txn.debit_minor is None and txn.credit_minor is None):
            amounts_incomplete = True
            txn.flags.append("missing_amount")
            prev_balance = txn.balance_minor
            txn.flags = _dedupe(txn.flags)
            continue

        expected = prev_balance + (txn.credit_minor or 0) - (txn.debit_minor or 0)
        if txn.balance_minor != expected:
            txn.flags.append("balance_break")
        prev_balance = txn.balance_minor
        txn.flags = _dedupe(txn.flags)

    if amounts_incomplete:
        statement_flags.append("amounts_incomplete")
    elif opening_minor is not None and closing_minor is not None:
        credits = sum(txn.credit_minor or 0 for txn in txns)
        debits = sum(txn.debit_minor or 0 for txn in txns)
        if opening_minor + credits - debits != closing_minor:
            statement_flags.append("closing_mismatch")
    else:
        statement_flags.append("missing_statement_balances")

    if extracted_count != len(txns):
        statement_flags.append("row_count_mismatch")
    return statement_flags
