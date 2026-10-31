from daftar.invoice_extract import (
    USD_AED_PEG_SCALED,
    apply_fx,
    names_match,
    parse_doc_date,
    parse_invoice_text,
    to_aed,
)

# Synthetic layouts only (no real parties, TRNs or IBANs).
SALES_USD = """
Desert Falcon Services FZE Premise# 12, Dubai Silicon Oasis, IFZA Business Park
INVOICE
TRN (VAT): 100000000000003
INVOICE #
DATE
26-06-001-DF
1-Jun-2026
BILL TO
GULF CREST TRADING LLC
Office 4, Business Bay, Dubai
TRN (VAT): 100000000000011
DESCRIPTION
QTY
UOM
PRICE
S0001 CONSULTING RETAINER MAY'26
1
EA
USD 10,000
VAT APPLIED AT 5%
USD 500
TOTAL USD 10,500
"""

PROFORMA_AED = """
Proforma Invoice
Proforma# PI-00100
Sub Total
2,000.00
Total
AED2,000.00
Proforma Date :
29 Jul 2026
ARNIFI SAMPLE SERVICES L.L.C
TRN: 100000000000029
Bill To
Desert Falcon Services FZE
Description
Amount
1
Free zone licence amendment x 1
2,000.00
Notes
Prices include any applicable taxes and government fees.
"""

PURCHASE_TAX_INVOICE = """
Palm Grove Supplies LLC
TAX INVOICE
TRN 100000000000037
Invoice No: PG-7781
Invoice Date: 14/08/2026
Bill To: Desert Falcon Services FZE
Description
Office chairs x 4
Sub Total AED 4,000.00
VAT 5% AED 200.00
Total AED 4,200.00
"""


def test_sales_invoice_label_value_blocks():
    facts = parse_invoice_text(SALES_USD, doc_type="SALES_INVOICE", company_names=["Desert Falcon"])
    assert facts["invoiceNumber"] == "26-06-001-DF"
    assert facts["entryDate"] == "2026-06-01"
    assert facts["currency"] == "USD"
    assert facts["originalSubtotalMinor"] == 1_000_000
    assert facts["originalVatMinor"] == 50_000
    assert facts["originalTotalMinor"] == 1_050_000
    assert facts["issuerTrn"] == "100000000000003"
    assert facts["customerTrn"] == "100000000000011"
    assert facts["counterparty"] == "GULF CREST TRADING LLC"
    assert "possible_government_fees" not in facts["warnings"]
    assert "looks_like_purchase" not in facts["warnings"]


def test_proforma_is_flagged_not_postable():
    facts = parse_invoice_text(PROFORMA_AED, doc_type="PURCHASE_INVOICE", company_names=["Desert Falcon"])
    assert facts["docKind"] == "PROFORMA"
    assert facts["invoiceNumber"] == "PI-00100"
    assert facts["entryDate"] == "2026-07-29"
    assert facts["originalTotalMinor"] == 200_000
    assert facts["supplierTrn"] == "100000000000029"
    assert "not_a_tax_invoice" in facts["warnings"]
    assert "possible_government_fees" in facts["warnings"]


def test_purchase_tax_invoice_same_line_values():
    facts = parse_invoice_text(PURCHASE_TAX_INVOICE, doc_type="PURCHASE_INVOICE", company_names=["Desert Falcon"])
    assert facts["docKind"] == "TAX_INVOICE"
    assert facts["invoiceNumber"] == "PG-7781"
    assert facts["entryDate"] == "2026-08-14"
    assert facts["originalSubtotalMinor"] == 400_000
    assert facts["originalVatMinor"] == 20_000
    assert facts["counterparty"] == "Palm Grove Supplies LLC"
    assert facts["supplierTrn"] == "100000000000037"
    assert "supplier_trn_missing" not in facts["warnings"]


def test_direction_mismatch_warns():
    facts = parse_invoice_text(SALES_USD, doc_type="PURCHASE_INVOICE", company_names=["Desert Falcon"])
    assert "looks_like_sales" in facts["warnings"]


def test_fx_conversion_half_up():
    assert to_aed(50_000, USD_AED_PEG_SCALED) == 183_625
    assert to_aed(75_000, USD_AED_PEG_SCALED) == 275_438  # 2754.375 -> 2754.38
    facts = apply_fx({"currency": "USD", "originalSubtotalMinor": 1_000_000, "originalVatMinor": 50_000}, USD_AED_PEG_SCALED, "usd_peg_default")
    assert facts["taxableMinor"] == 3_672_500
    assert facts["vatMinor"] == 183_625
    assert facts["totalMinor"] == 3_856_125
    assert "fx_rate_defaulted" in facts["warnings"]
    missing = apply_fx({"currency": "EUR", "originalSubtotalMinor": 100, "originalVatMinor": 5}, None, None)
    assert missing["taxableMinor"] is None
    assert "fx_rate_needed" in missing["warnings"]


def test_name_match_tolerates_one_letter():
    assert names_match("Alphacntrl", "ALPHACTRL AI SOFTWARE SERVICES - FZCO")
    assert not names_match("Gulf Crest", "Palm Grove Supplies LLC")


def test_dates():
    assert parse_doc_date("1-Jun-2026") == "2026-06-01"
    assert parse_doc_date("29 Jul 2026") == "2026-07-29"
    assert parse_doc_date("14/08/2026") == "2026-08-14"
    assert parse_doc_date("August 3, 2026") == "2026-08-03"
