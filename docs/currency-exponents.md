# Currency exponents

Phase 1 stores every amount as an integer number of hundredths, plus a currency code. The exponent is 2 for the whole ledger. AED fils match that scale. A value is never a binary float.

## What Phase 1 accepts

One or two digits after the decimal point are hundredths:

| Text | Minor units |
| --- | --- |
| `1` | 100 |
| `1.2` | 120 |
| `1.23` | 123 |

`1.230` is rejected. The trailing zero is still a third decimal place. The parser does not trim it and does not treat the text as `1.23`. `1.234` is rejected for the same reason: a third digit would have to be rounded or dropped, and Phase 1 does neither.

KWD, BHD, and OMR are quoted to three decimal places (exponent 3). Upload refuses a statement whose `Currency` header is one of those codes, before the file is stored. The API error code is `unsupported_currency`. The message names the code and says Phase 1 accepts only 2-decimal currencies, such as AED.

## Phase 2 ledger

Store the ISO 4217 exponent with the currency, not as a global constant.

- `currencies(code, exponent, minor_name)` with AED at exponent 2 and KWD, BHD, and OMR at exponent 3.
- Amount columns stay integers. The minor unit is `major * 10^exponent + fraction`. For exponent 3, `1.230` is 1230 and `1.23` is 1230 only after the text is padded to three places. A fourth digit is still an error.
- A posting row records `currency` and the exponent used at write time, so a later change to the currency table does not reinterpret old rows.
- Existing Phase 1 rows are AED at exponent 2. No backfill changes their integers.
- Display, CSV export, and balance checks read the row's exponent. They do not assume 100.
- Cross-currency sums stay out of scope until a rate table exists. A trial balance is per currency.

The upload gate can then accept KWD by parsing with that currency's exponent instead of rejecting the code.
