---
title: "ADR-0002: TurboModule + JSI install layout and codegen package structure"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0002: TurboModule + JSI install layout and codegen package structure

## Status
Accepted (2026-05-10).

## Context
ADR-0001 committed to TurboModule + JSI as the only native-JS contract and to JSON Schema as the single source of truth driving codegen. This ADR specifies the concrete monorepo package layout, the naming of generated artefacts, and the rules for when and how codegen runs — questions that gate the first commit.

Three constraints shape the decision:
1. React Native's codegen (`react-native-codegen`) requires a specific file naming convention (`NativeXxx.ts` / `NativeXxx.js`) to discover TurboModule specs.
2. The HostObject (JSI side) is a separate C++ layer from the TurboModule spec; mixing them in one package creates dependency confusion.
3. Generated artefacts must be committed to the repo so that consumers can install the package without running the codegen toolchain themselves.

## Decision

### Package layout

```
packages/
  schema/                   ← source of truth (JSON Schema)
    threat-schema.json
    package.json            ← no runtime deps; pure schema
  guardian-rn/              ← the published npm package
    src/
      generated/            ← codegen output: TS types (committed)
        ThreatId.ts
        GuardianConfig.ts
        ...
      NativeGuardianRN.ts   ← TurboModule spec (hand-authored, references generated types)
      jsi/
        GuardianHostObject.ts  ← JSI HostObject type declarations
    android/
      src/main/kotlin/.../generated/   ← Kotlin sealed classes (committed)
      build.gradle
      CMakeLists.txt        ← C++ JSI HostObject build
    ios/
      Generated/            ← Swift enums (committed)
      GuardianRN.mm         ← TurboModule ObjC++ bridge
      GuardianHostObject.{h,cpp}
    package.json
    react-native.config.js  ← points RN CLI to the native folders
  codegen/                  ← internal tool package, not published
    src/
      index.ts              ← CLI entry: reads schema/, writes generated/
    package.json
```

### Naming rules for generated files

| Input schema type | TS output | Kotlin output | Swift output |
|---|---|---|---|
| `threatId` enum | `ThreatId.ts` | `ThreatId.kt` (sealed class) | `ThreatId.swift` (enum) |
| `severity` enum | `Severity.ts` | `Severity.kt` | `Severity.swift` |
| `GuardianConfig` object | `GuardianConfig.ts` | `GuardianConfig.kt` (data class) | `GuardianConfig.swift` (struct) |
| `Evidence` object | `Evidence.ts` | `Evidence.kt` | `Evidence.swift` |

### Codegen invocation

- **Local development:** `npm run codegen` (workspace root) — runs `packages/codegen/src/index.ts` via `tsx`.
- **CI (PR check):** codegen runs and diffs the output against HEAD. If the diff is non-empty the check fails with "generated artefacts are stale — run `npm run codegen` and commit". This enforces schema-artefact consistency without requiring consumers to have the codegen toolchain.
- **Pre-commit hook:** optional but recommended via `simple-git-hooks` — prevents stale artefacts from being committed locally.

### JSI HostObject vs TurboModule spec

The TurboModule spec (`NativeGuardianRN.ts`) exposes only the bridging surface (start, stop, getSessionKey). The JSI HostObject (`GuardianHostObject`) is a C++ object that holds the per-process HMAC session key and is passed to JS via `global.__guardianHostObject`. These are two distinct native artefacts built from the same package but with different responsibilities — the TurboModule handles lifecycle; the HostObject handles key delivery and synchronous signing queries.

### RN new architecture baseline

`react-native.config.js` sets `codegenConfig.type = "modules"` and points to `NativeGuardianRN.ts`. No legacy bridge registration (`RCT_EXPORT_MODULE`) is used in `v1.x`. The Expo config plugin (in `packages/expo-plugin/`) calls `withBuildscriptDependency` and `withAndroidMinSdkVersion(24)` — unchanged from the freerasp-rn plugin shape.

## Consequences
- Committing generated artefacts increases repo size slightly but removes the codegen toolchain as a consumer dependency.
- The CI diff check means a schema change without a corresponding `npm run codegen` will always fail fast.
- Two native build artefacts (TurboModule + HostObject) means the Android `CMakeLists.txt` and iOS `.podspec` must both be maintained — small but real overhead.
- Consumers on RN < 0.74 cannot use this package (ADR-0001 constraint); the CI check for minimum RN version lives in the Expo plugin.

## Alternatives considered
- **Single `guardian-rn` package with no separate `schema/` package** — rejected; makes it impossible to consume the schema from the collector or the codegen tool without pulling in the full RN package.
- **Generate artefacts on `postinstall`** — rejected; requires consumers to have the codegen toolchain and causes non-deterministic builds.
- **Separate npm packages for Kotlin and Swift artefacts** — rejected; adds publish complexity with no consumer benefit, since both are consumed only by the native module build.

## Links
- ADR-0001 (architecture baseline)
- `03-implementation-plan.md` §Phase 1
- `packages/codegen/README.md` (to be written in Phase 1)
