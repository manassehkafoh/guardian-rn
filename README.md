# guardian-rn

> Production-grade React Native Runtime Application Self-Protection (RASP) SDK.

[![CI](https://github.com/manassehkafoh/guardian-rn/actions/workflows/ci.yml/badge.svg)](https://github.com/manassehkafoh/guardian-rn/actions/workflows/ci.yml)

`guardian-rn` is a successor to `freerasp-react-native` with explicit goals around type safety, multi-instance JS hygiene, vendor pluggability, and integrity of the native↔JS bridge. It provides continuous mobile threat detection and policy enforcement for React Native (≥ 0.74).

## Architecture Summary

Guardian-RN utilizes a multi-layered architecture focused on continuous monitoring, granular responses, and bridge integrity without legacy dependencies.
- **TurboModule + JSI** — no legacy bridge (RN ≥ 0.74 required).
- **Codegen** — JSON Schema drives TypeScript, Kotlin, and Swift type artefacts from a single source of truth.
- **HMAC-SHA256 envelopes** — cross-layer threat events utilize per-process session keys, monotonic sequence numbers, and RFC 8785 canonical JSON to guarantee message authenticity.
- **Pluggable engines** — community engine in-tree; commercial adapters as optional packages.
- **Response policies** — `telemetry | restrict | lockout | kill`; `kill` is opt-in with a grace period for UX messages.
- **Centralised observability** — Forward telemetry and health ticks directly to your backend or MDM.

For an extensive dive into our architecture, threat taxonomy, and security lifecycle, refer to [Architecture Document](docs/architecture.md) and [ADR-0001](docs/adr/0001-architecture-baseline.md) for the baseline decision.

## Packages Overview

This repository is structured as a monorepo containing multiple decoupled components:

| Package | Description | Directory |
|---|---|---|
| `@guardian/schema` | JSON Schema — the single source of truth defining threat events and configurations. | `packages/schema` |
| `@guardian/rn` | The published SDK (TurboModule + JSI + hooks). | `packages/guardian-rn` |
| `@guardian/codegen` | Internal tooling that generates TS / Kotlin / Swift artefacts from `@guardian/schema`. | `packages/codegen` |
| `@guardian/collector` | Backend Node.js Fastify ingestion service with mTLS, HMAC verify, and ECS validation. | `packages/collector` |
| `@guardian/engine-community` | The default, open-source mobile threat detection engine. | `packages/engine-community` |

## Quick start

```bash
# Install the core SDK in your RN app
npm install @guardian/rn

# Regenerate artefacts after schema changes (if contributing)
npm run codegen

# Run the local observability stack (Collector)
cd packages/collector && docker compose up -d
```

## Requirements

- **React Native:** ≥ 0.74
- **Android API:** ≥ 24
- **iOS:** ≥ 15.1
- **Node:** ≥ 20

## Development & Contribution

To set up the workspace for local development:

```bash
npm install          # install all workspace dependencies
npm run codegen      # generate TS / Kotlin / Swift artefacts
npm run typecheck    # TypeScript type-check
npm test             # run all tests
npm run lint         # check code health
```

When creating PRs for this project, prefix the title with relevant emojis (e.g. 🧹 for code health, ⚡ for performance, 🧪 for testing, 🛡️ for security). See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Documentation

Full wiki, ADRs, labs, and onboarding guides:
- `docs/` — [Architecture overview](docs/architecture.md), runbook, glossary
- `docs/adr/` — Architectural Decision Records (ADR-0001 through ADR-0010)
- `docs/labs/` — hands-on labs for onboarding engineers

## Licence

MIT
