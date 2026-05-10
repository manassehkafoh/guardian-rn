# guardian-rn

> Production-grade React Native Runtime Application Self-Protection (RASP) SDK.

[![CI](https://github.com/manassehkafoh/guardian-rn/actions/workflows/ci.yml/badge.svg)](https://github.com/manassehkafoh/guardian-rn/actions/workflows/ci.yml)

`guardian-rn` is a successor to `freerasp-react-native` with explicit goals around type safety, multi-instance JS hygiene, vendor pluggability, and integrity of the native↔JS bridge.

## Architecture

- **TurboModule + JSI** — no legacy bridge (RN ≥ 0.74 required)
- **Codegen** — JSON Schema drives TypeScript, Kotlin, and Swift type artefacts from a single source of truth
- **HMAC-SHA256 envelopes** — per-process session keys; monotonic sequence numbers; RFC 8785 canonical JSON
- **Pluggable engines** — community engine in-tree; commercial adapters as optional packages
- **Response policies** — `telemetry | restrict | lockout | kill`; `kill` is opt-in with grace period
- **Centralised observability** — ELK + Grafana + weekly digest reporting

See [ADR-0001](docs/adr/0001-architecture-baseline.md) for the full baseline decision.

## Packages

| Package | Description |
|---|---|
| `@guardian/schema` | JSON Schema — single source of truth |
| `@guardian/rn` | The published SDK (TurboModule + JSI + hooks) |
| `@guardian/codegen` | Internal tool: schema → TS / Kotlin / Swift artefacts |
| `@guardian/collector` | Ingest service: mTLS, HMAC verify, ECS validate, fan-out |

## Quick start

```bash
# Install
npm install @guardian/rn

# Regenerate artefacts after schema changes
npm run codegen

# Run the local observability stack
cd packages/collector && docker compose up -d
```

## Requirements

- React Native ≥ 0.74
- Android API ≥ 24
- iOS ≥ 15.1
- Node ≥ 20

## Development

```bash
npm install          # install all workspace dependencies
npm run codegen      # generate TS / Kotlin / Swift artefacts
npm run typecheck    # TypeScript type-check
npm test             # run all tests
```

## Documentation

Full wiki, ADRs, labs, and onboarding guide:
- `docs/` — architecture overview, runbook, glossary
- `docs/adr/` — Architectural Decision Records (ADR-0001 through ADR-0010)
- `docs/labs/` — hands-on labs for onboarding engineers

## Licence

MIT
