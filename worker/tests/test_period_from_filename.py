from daftar.extract import period_range_from_filename, period_range_from_text, _normalise_period_token


def test_normalise_month_name_dates():
    assert _normalise_period_token("Aug 1, 2026") == "2026-08-01"
    assert _normalise_period_token("August 31, 2026") == "2026-08-31"
    assert _normalise_period_token("1 Aug 2026") == "2026-08-01"


def test_period_from_bank_filename():
    start, end = period_range_from_filename("statement(Aug 1, 2026 - Aug 31, 2026).pdf")
    assert start == "2026-08-01"
    assert end == "2026-08-31"


def test_period_from_iso_text():
    start, end = period_range_from_text("Period: 2026-08-01 to 2026-08-31")
    assert start == "2026-08-01"
    assert end == "2026-08-31"
