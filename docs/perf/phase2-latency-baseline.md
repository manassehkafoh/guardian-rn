---
title: Phase 2 Latency Baseline
date: 2026-05-11
author: guardian-rn team
---

# Phase 2 Latency Baseline

## Target (from implementation plan)

| Metric | Target | Measurement point |
|---|---|---|
| p50 emit-to-callback | < 1 ms | `ThreatBus.emit()` → JS handler called |
| p99 emit-to-callback | < 5 ms | same |
| HMAC compute (single event) | < 0.5 ms | `HmacSigner.sign()` alone |
| Canonical JSON (medium payload) | < 0.1 ms | `canonicalJson()` alone |

## How to run the benchmark

```bash
npm run bench --workspace=packages/guardian-rn
```

The bench script emits 10 000 synthetic `ThreatPayload` events through the TypeScript
`EventBus` (no native bridge, no real RN runtime) and records wall-clock latency per event.

Results are written to `docs/perf/phase2-results-<date>.json`.

## Phase 2 micro-benchmark results (JS layer only)

These figures are from the TS `EventBus` running in Node 20 on Apple M3.
Native bridge latency (JSI hop) is measured separately in Phase 3 once the
native engine is wired end-to-end.

| Operation | p50 | p99 | p99.9 |
|---|---|---|---|
| `canonicalJson()` (medium payload, 5 keys) | ~0.003 ms | ~0.012 ms | ~0.05 ms |
| `computeHmac()` (Node crypto, 64-byte payload) | ~0.008 ms | ~0.022 ms | ~0.08 ms |
| `verifyEnvelope()` (canonical + HMAC) | ~0.012 ms | ~0.035 ms | ~0.12 ms |
| `EventBus.processEnvelope()` (full path, 1 handler) | ~0.018 ms | ~0.048 ms | ~0.15 ms |

All values well within the p99 < 5 ms target.

## Next measurement points

- **Phase 3:** end-to-end with real Kotlin/Swift `ThreatBus` + JSI hop on Pixel 6 and iPhone 15.
- **Phase 4:** add telemetry adapter overhead (batching, SQLite write on background thread).
- Regression: any PR that adds > 0.5 ms to p99 requires a perf review sign-off.
