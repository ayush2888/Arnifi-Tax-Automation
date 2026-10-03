from daftar.parsers import pick_parser, register_builtin_parsers


def test_builtin_parsers_registered():
    parsers = register_builtin_parsers()
    names = {p.name for p in parsers}
    assert "stripe_balance_history" in names
    assert "bank_uae_a" in names
    assert "bank_uae_b" in names
    assert "card_generic" in names
    assert "invoice_generic" in names
    assert "gateway_pdf_generic" in names


def test_stripe_parser_picks_balance_history():
    content = b"created,currency,gross,fee,reporting_category\n2026-01-02,aed,100.00,3.00,charge\n"
    parser, score = pick_parser("stripe_balance_history.csv", "text/csv", content)
    assert parser is not None
    assert score >= 90
    parsed = parser.parse("stripe_balance_history.csv", "text/csv", content)
    assert parsed.doc_type == "GATEWAY_CSV"
    assert parsed.lines


def test_bank_uae_a_parser():
    content = b"Date,Description,Debit,Credit,Balance,Reference\n2026-01-03,Sale,,50.00,50.00,R1\n"
    parser, score = pick_parser("northwind_uae_a.csv", "text/csv", content)
    assert parser is not None
    parsed = parser.parse("northwind_uae_a.csv", "text/csv", content)
    assert parsed.doc_type == "BANK_STATEMENT"
    assert len(parsed.lines) == 1
    assert parsed.lines[0].amount_minor == 5000
