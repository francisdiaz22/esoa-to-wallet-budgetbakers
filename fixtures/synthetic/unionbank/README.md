# UnionBank synthetic CSV fixture

This fixture is generated test data for `unionbank-ph-csv-v1`. It was created
for this repository's parser and route integration tests; it was not copied,
redacted, or derived from a real UnionBank statement or account export.

All dates, descriptions, amounts, and identifiers are synthetic. The fixture
contains no account number, card number, token, personal data, or real merchant
record. The files are explicitly allowlisted in the repository `.gitignore`
after provenance review.

`statement.csv` uses the parser's exact header:

```text
DATE,DESCRIPTION,CURRENCY,AMOUNT
```

Positive PHP amounts represent statement charges and become negative expense
amounts. The negative synthetic credit is retained as an excluded source row;
it is not proposed as an expense. `expected_extraction.csv` is a semicolon-
delimited row-level oracle with the deterministic source IDs, source order,
normalized dates, signed amounts, and exclusion reason.
