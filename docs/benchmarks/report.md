# Benchmark report

**Version:** 0.1.0 • **Fixtures:** synthetic-bdo-v1, eval-v1

> Synthetic only. Not a guarantee. See `docs/benchmarks/README.md` for methodology.

## Extraction
- Parser: bdo-visa-gold-ph-image-v1 • Format: ocr
- Proposed: 33 + Excluded: 4 = 37 recognized
- Total: PHP 34,957.17 • Precision: 1 • Recall: 1 • F1: 1
- Reconciliation: 37 recognized = 33 proposed + 4 excluded; all negative proposed amounts; PHP 34,957.17

## Classification
- Total: 20 • Baseline: {"total":20,"coverage":0.7,"precision":1,"unknownRate":0.3,"lowConfidenceRate":0,"malformedUnavailableRate":0,"perCategorySupport":{"Shopping":4,"Electronics":1,"Groceries":1,"Health & Fitness":1,"unknown":2,"Home & Garden":2,"Fees":1,"Fast Food":1,"Travel":1,"Transportation":1,"Fuel":1,"Health":1,"Restaurants":1,"Phone & Internet":1,"Other":1},"confidenceBuckets":[{"range":"0.0-0.2","count":0,"correct":0,"accuracy":0},{"range":"0.2-0.4","count":3,"correct":2,"accuracy":0.6666666666666666},{"range":"0.4-0.6","count":3,"correct":0,"accuracy":0},{"range":"0.6-0.8","count":0,"correct":0,"accuracy":0},{"range":"0.8-1.0","count":14,"correct":14,"accuracy":1}]}
- Fake provider: {"total":20,"coverage":0.9,"precision":1,"unknownRate":0.1,"lowConfidenceRate":0,"malformedUnavailableRate":0,"perCategorySupport":{"Shopping":4,"Electronics":1,"Groceries":1,"Health & Fitness":1,"unknown":2,"Home & Garden":2,"Fees":1,"Fast Food":1,"Travel":1,"Transportation":1,"Fuel":1,"Health":1,"Restaurants":1,"Phone & Internet":1,"Other":1},"confidenceBuckets":[{"range":"0.0-0.2","count":0,"correct":0,"accuracy":0},{"range":"0.2-0.4","count":2,"correct":2,"accuracy":1},{"range":"0.4-0.6","count":0,"correct":0,"accuracy":0},{"range":"0.6-0.8","count":0,"correct":0,"accuracy":0},{"range":"0.8-1.0","count":18,"correct":18,"accuracy":1}]}

## Duplicates & splits
- 33-source → 35-leaf, PHP 34,957.17; commit-eligibility invariants enforced (only approved valid leaves).

## Wallet
- Scenarios: all-success, mixed 207, throttle 429 with Retry-After, initial-sync 409, timeout/unknown → not auto resent, retryable server_error → server-selected retry only; per-inputIndex correlation; mixed 207 handling; 429 Retry-After bounded wait; unknown never auto-resent.

## Timing
Machine-specific measured timing is emitted to the CI artifact `benchmark-timing.json`; it is not committed or used as a release guarantee.

## Limitations
- fixture-backed formats only (BDO Visa Gold PHP image); synthetic bias
- local-model/OCR variance
- no cross-session idempotency
- no cross-Wallet duplicate matching
- single currency PHP
