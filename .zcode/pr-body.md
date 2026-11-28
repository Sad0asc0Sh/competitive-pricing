## Summary

Fragmented marketplaces list one product as many independent single-seller cards with different canonical titles. Discovery retrieved only a fraction of them. This PR makes the **retrieval and inspection architecture** more complete, diverse and bounded — **without relaxing any identity-verification gate** (perla-style variants, 315 MHz, pack quantity, family markers all still excluded from automatic pricing).

### Root causes fixed (code-level, audited at 335052c)

| # | Limitation | Fix |
|---|---|---|
| 1 | `confirmed_consolidated` stopped after **1** search request | early stop requires a ≥3 fast-query floor |
| 2 | Hard budgets 6/10 searches, 24 rows, 2 pages | ROW_LIMIT 30, adaptive pages, **bounded yield-aware continuation pool** (`searchContinuationRequests`) — phase 2 capped at ⅔ of the pool, first zero-new-PRK wave ends it |
| 3 | `plateau` counted only *promising* gain | plateau now counts fresh **unique PRKs** too |
| 4 | Early return skipped Phase 2 for coded confident runs | removed; needsExpansion gate + empty-queue break remain |
| 5/6 | Known/confirmed PRKs consumed the whole detail shortlist | known-hint and confirmed blocks capped at **half the detail quota per run** |
| 7 | Incomplete pagination | up to 3 yield-ranked streams paginated; `promisingYield` ordering |
| 8 | Similar seeds gated by seller counts | probes open for coded fragmented markets; seller-count no longer treated as a coverage signal |
| 9 | Seller-title vocabulary skipped after 3 verified sellers | vocabulary feeds queries for all products; listings of incompatible/family-marked cards excluded from vocab sources |
| 10 | Direct-PRK lock = zero discovery forever | scheduler extended passes broaden locked products (saved PRK kept as known hint); `runner` schedules them; interactive fast path preserved |
| 11 | Hybrid index caps (8 links / 40 rows / 5 hits, AND-only FTS) | links 8→16 (recency-ordered within tier), two-budget UNION window (trigram/lexical vs seller-count) with OR-FTS + pg_trgm branches + legacy fallback, RRF cut 5→12, catalog upsert now **merges** seller vocabulary instead of overwriting it |

### New per-inquiry diagnostics

`searchStoppingReason` / `detailsStoppingReason`, `knownPrksInspected` / `newPrksInspected`, `singleSellerPrksDiscovered` / `multiSellerPrksDiscovered` (+ inspected), `estimatedRemainingDiscoveryOpportunity`, `yieldContinuationRequestsUsed`. Coverage is never reported `complete_within_scope` while promising uninspected candidates or unexplored pages remain.

### Safeguards preserved (verified by tests)

Named product-family gates, model/variant contradictions, frequency/protocol/button/package checks, seller-level identity checks, own-store exclusion, `MATCH_CONFIRMED`-only pricing eligibility — all unchanged; `torob-wall-remote-regression`, `torob-seller-family-gate`, `torob-link-revalidation`, `torob-seller-title-discovery` suites pass unmodified (ST11 stale-hint fail-closed pin intact).

### Tests & benchmark

- New `tests/torob-discovery-recall.test.cjs` + fixture: **1 consolidated + 10 independent single-seller cards** across queries/pages/sorts/similar/vocab channels, perla & 315/pack negatives, stale cached PRK, incomplete MCP response, known-PRK starvation, direct-PRK lock/extended unlock. **11/11 relevant PRKs discovered within ≤26 API requests.**
- On the previous commit (335052c) the same dataset fails (10/11 discovered, no fairness diagnostics); this PR passes 6/6.
- `discovery-benchmark` (10 categories): candidate/seller recall **0.95** (prev 0.925/0.933), false confirmations **0**, transparency violations **0**, warm cache hit 1.0, cold p50/p95 ≈ 223/384 ms, ≤ ~11 API calls/inquiry.
- Full suite: 309 tests / 308 pass / 1 env-skipped (postgres), typecheck, lint, `next build` all green.

### Not covered

- Live PostgreSQL benchmark of the widened index window (unit tests exercise the in-memory path; the PG window has a legacy fallback if `pg_trgm` is missing).
- Live validation against real Torob MCP.

🚢 PR intentionally **not merged**.
