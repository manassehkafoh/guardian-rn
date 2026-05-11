# `guardian-rn` — Step-by-Step Implementation Plan

> **Companion to:** `01-product-and-solution-design.md` (analysis) and `02-superior-solution-proposal.md` (target design).
> **Scope:** Concrete, executable plan to ship `guardian-rn` from empty repo to v1.0.0 on npm.
> **Working assumption:** A small team (2 senior eng + 1 part-time SDET + 1 PM, plus security advisor on retainer). Single-team estimates in calendar weeks; halve elapsed time for a 4-eng team.

---

## 0. North-Star Definition of Done (v1.0)

We declare v1.0 when **all** of the following hold:

- [ ] An app on RN ≥ 0.74 with the New Architecture enabled can `import { useGuardian } from 'guardian-rn'` and detect at least the freeRASP-RN parity threat set on Android and iOS.
- [ ] An existing `freerasp-react-native` consumer can replace the import with `guardian-rn/compat/freerasp-rn` and observe **identical behaviour** for the 22-threat surface (drop-in green-field test app passes).
- [ ] HMAC-signed bridge envelopes are verified on every event in JS; tampering tests fail closed.
- [ ] Talsec adapter (`@guardian/engine-talsec`) is a separate, optional package; the core has zero closed-source binary deps.
- [ ] Community engine detects: root binaries, debugger attached, emulator props, basic Frida/Xposed signatures — on both platforms.
- [ ] Test coverage ≥ 85% line on JS; ≥ 70% on Kotlin & Swift.
- [ ] Threat-model doc, migration guide, API reference, and 2 policy recipes published in `docs/`.
- [ ] CI matrix green: RN 0.74/0.75/0.76 × iOS 16/17/18 × Android 10/12/14/15.
- [ ] Public security advisory pipeline live (`SECURITY.md` + advisory mailbox + signed-release verification).

---

## 1. Phasing Overview

| Phase | Theme | Duration | Headline deliverable |
|---|---|---|---|
| **P0** | Discovery & contracts | 2 weeks | Schemas frozen, codegen scaffolded, repo skeleton |
| **P1** | TurboModule foundation | 3 weeks | Empty TurboModule starts/stops on iOS+Android, codegen wired |
| **P2** | JSI bridge + HMAC | 3 weeks | Signed envelope round-trips JS↔native; replay detection works |
| **P3** | Core engines | 4 weeks | Community engine + Talsec adapter both emit events |
| **P4** | JS API & state machine | 3 weeks | `useGuardian`, refcounted store, response policies |
| **P5** | Platform polish | 3 weeks | Multi-scene iOS, encrypted storage, screen-cap, lifecycle |
| **P6** | Compat & migration | 2 weeks | `freerasp-rn` shim, e2e parity test app |
| **P7** | Hardening & docs | 3 weeks | Tests to coverage targets, threat model, docs site, recipes |
| **P8** | Beta → GA | 3 weeks | Public beta, fixes, signed v1.0.0 release |
| **Total** | | **~26 weeks (6 months)** | |

Dependencies are mostly linear (each phase opens the work of the next), with parallelisable tracks called out per phase.

---

## 2. Phase 0 — Discovery & Contracts (Weeks 1–2)

**Goal:** Lock the contracts everything else generates from. Shipping nothing here causes weeks of rework later.

### 2.1 Activities

1. **Repo skeleton** (`yarn create react-native-library guardian-rn`, then strip its example app and rebuild with our layout from §4 of the proposal).
2. **Author `src/schema/threats.schema.json`** — every threat id, severity, evidence shape, with JSON-Schema `oneOf` for the discriminated union.
3. **Author `src/schema/config.schema.json`** — engine names, policy variants, telemetry adapter contract.
4. **Stand up codegen** (`scripts/codegen.ts`) using `quicktype` or hand-rolled visitor:
   - Emits `src/codegen/threats.ts` (TS types).
   - Emits `android/.../codegen/Threats.kt` (Kotlin sealed classes + companion `ALL_THREATS`).
   - Emits `ios/.../Codegen/Threats.swift` (Swift enums + `allCases`).
5. **Decide engine names** (final list, frozen): `community`, `talsec`. Future: `promon`, `appicrypt`.
6. **Decide bridge envelope binary format** — JSON + base64 HMAC for v1; reserve a flag bit for protobuf later.
7. **Threat model v0** — write `docs/threat-model.md` first draft. Get external security review before P2.
8. **Decide RN baseline**: minimum 0.74 (TurboModule + Codegen stable). Document in README.
9. **Pick package manager**: yarn 4 / pnpm — pick one and lock.
10. **Set up CI shell**: lint, prettier, typecheck only (build/test land in P1).

### 2.2 Deliverables

- `guardian-rn/` repo on GitHub (private until P8).
- Frozen `*.schema.json` files with semver-1.0 tag.
- Working `yarn codegen` command producing TS / Kotlin / Swift artefacts.
- `docs/threat-model.md` (v0 draft, marked **PRELIMINARY**).
- ADR-001 (architecture decision record) covering: TurboModule choice, HMAC vs nothing, JSON vs protobuf, monorepo vs split repo for engine adapters.

### 2.3 Exit criteria

- A maintainer can run `yarn codegen` on a clean checkout and the diff is empty (idempotent).
- A new threat added to the schema produces matching TS/Kotlin/Swift artefacts in one pass.
- All ADRs reviewed and merged.

### 2.4 Risks

- **Schema bikeshedding** — time-box discussions to 1 week, freeze, plan v1.1 amendments instead.
- **Codegen scope creep** — generate types only; engine adapters do their own bridging by hand.

---

## 3. Phase 1 — TurboModule Foundation (Weeks 3–5)

**Goal:** A no-op TurboModule that starts, stops, and is wired through Codegen on both platforms in an example app.

### 3.1 Activities

1. **Define `src/specs/NativeGuardian.ts`** — TurboModule spec with `start/stop/isRunning/setExternalId/getExternalId/blockScreenCapture/isScreenCaptureBlocked/getAppIcon/registerEngine`. No bus methods yet (those come via JSI in P2).
2. **Run RN codegen** (`react-native-codegen`) to produce JNI/Obj-C++ glue.
3. **Implement Android `GuardianModule.kt`** as `ReactContextBaseJavaModule` (TurboModule entry):
   - Stub each method to log + resolve.
   - Wire `LifecycleEventListener`.
   - Set up `EngineRegistry` (empty).
4. **Implement iOS `GuardianModule.swift`** as `RCTEventEmitter` subclass with TurboModule conformance:
   - Stub each method.
   - Wire `UIApplication` lifecycle observers.
5. **Pod & gradle plumbing**:
   - `guardian-rn.podspec` with codegen mode flags.
   - `android/build.gradle` with `react` block for codegen.
6. **Bring up the example app** (`example/`):
   - RN 0.74 fresh template, New Arch enabled.
   - Calls `start()`/`stop()`.
   - Logs to a UI list.
7. **CI build matrix** starts here:
   - Job: lint+typecheck+codegen-up-to-date.
   - Job: build-android (yarn workspaces, gradle).
   - Job: build-ios (pod install, xcodebuild for example).
8. **First Detox test**: app boots, calls `start()`, `isRunning()` returns true.

### 3.2 Deliverables

- Green CI on Android + iOS for an empty-but-wired TurboModule.
- Example app demonstrating `start()` → `isRunning() === true`.
- ADR-002: how we structure the TurboModule (Android/iOS file layout, JSI HostObject location).

### 3.3 Exit criteria

- `yarn example android` and `yarn example ios` both run, with both old and new arch toggleable for testing.
- Cold-start overhead measurement baseline captured (we'll budget against this in P5).

### 3.4 Parallel track (during P1)

- Security advisor reviews the threat model draft from P0.
- PM drafts the public landing page copy / repo README outline.

---

## 4. Phase 2 — JSI Bridge + HMAC (Weeks 6–8)

**Goal:** A real-time, integrity-checked event channel from native to JS. This is the highest-risk phase technically; do not compress it.

### 4.1 Activities

1. **Implement `GuardianHostObject` (C++/JSI) on each platform**:
   - Exposes `subscribe(filter, fn) → subscriberId`, `unsubscribe(id)`, `getSessionKey() → ArrayBuffer`.
   - Lives behind a single JSI install hook called from the TurboModule's `installJSIBindings()` (Android) / `installModule()` (iOS).
2. **Per-process session key**:
   - Android: `KeyGenerator.getInstance("HmacSHA256")` backed by `AndroidKeyStore` if API ≥ 23, else `SecureRandom` 32 bytes in process memory.
   - iOS: `SecRandomCopyBytes(_:_:)` 32 bytes; key never persisted.
   - Hand to JS via `getSessionKey()` JSI host-object call **once at startup**; JS holds it in a closure (not assignable to globals).
3. **HMAC envelope codec** (pure TS in `src/core/verifier.ts`):
   - `verifyEnvelope(envelope, key) → ThreatPayload | InvariantBreach`.
   - Use `@noble/hashes` (audited, MIT, no native deps) for HMAC-SHA256.
4. **Native HMAC signer** (Kotlin/Swift):
   - `Mac.getInstance("HmacSHA256")` (Android), `CCHmac` (iOS).
   - Canonical JSON serialiser (sort keys, no whitespace) — implement once, share via test vectors.
5. **Sequence numbers**:
   - `AtomicLong` (Android) / `OSAtomicAdd64` or `os_unfair_lock`-guarded `Int64` (iOS).
   - Reset per session start (not per app start — sessions begin at `Talsec.start` equivalent).
6. **`ThreatBus` skeleton**:
   - Android: `MutableSharedFlow<ThreatEnvelope>(replay = 32, onBufferOverflow = SUSPEND)`.
   - iOS: `AsyncStream<ThreatEnvelope>` with a continuation stored on the bus.
   - Both expose a `emit(payload: ThreatPayload)` that signs and pushes.
7. **JSI subscription fan-out**:
   - Native `ThreatBus` subscribes itself; on each event, walks the subscriber list, calls the JS function passed via `subscribe(...)` directly (no event-emitter, no main-thread hop except for JS thread affinity).
8. **Tampering tests** (the most important deliverable of this phase):
   - **T-HMAC-1**: Modify a payload byte before it reaches JS — JS verifier raises `InvariantBreach`.
   - **T-HMAC-2**: Replay an envelope (same seq) — JS detects.
   - **T-HMAC-3**: Skip a sequence number — JS logs gap, continues, but flags telemetry.
   - **T-HMAC-4**: Wrong key — verifier rejects every event.
9. **Performance test**: 10k synthetic events; measure p50/p99 emit-to-callback latency. Target p99 < 5 ms on Pixel 6 / iPhone 13.

### 4.2 Deliverables

- A test harness that emits synthetic `ThreatPayload`s through the real bus and asserts JS receives them with valid HMAC.
- Tampering test suite (4 cases above) green.
- Latency benchmark report committed to `docs/perf/`.

### 4.3 Exit criteria

- No event reaches a JS subscriber without HMAC verification passing.
- Sequence-number gap detection demonstrated.
- Session key never appears in any logged string (assert by grep + a proguard rule on Android).

### 4.4 Risks

- **JSI host-object on Android** historically had New-Arch growing pains. Pin to RN 0.74+ where this is stable; have an escape hatch to fall back to TurboModule-only event channel (loses sync, retains HMAC) if blocked.
- **Threading**: a JSI callback must run on the JS thread. The bus must hop via `CallInvoker` (Android) or `RCTBridge.invokeAsync` (iOS).

---

## 5. Phase 3 — Core Engines (Weeks 9–12)

**Goal:** Two real detection engines emitting through the bus. This is where the package becomes useful.

### 5.1 Activities — Talsec adapter (separate package)

1. Create `packages/engine-talsec/` (yarn workspace under the monorepo).
2. **Android**: `TalsecEngineAdapter.kt` implements `Engine`, owns the existing `Talsec.start(...)` call, subscribes to `ThreatListener` callbacks, translates each into `ThreatPayload(id, severity, confidence=1.0, evidence)`, emits to the shared `ThreatBus`.
3. **iOS**: `TalsecEngineAdapter.swift` extends `SecurityThreatCenter` (same pattern as freerasp-rn), but emits into our bus.
4. Pull severity from a static `talsec-severity-map.json` keyed by threat id (don't hard-code in Kotlin/Swift — keep tweakable).
5. Translate Talsec malware payload → our `SuspiciousAppInfo` shape (re-use `kotlinx.serialization` approach but encode as part of the typed evidence union, not a separate Base64 field).
6. Lift Talsec's `appBundleId/appTeamId/watcherMail` config under `engines.talsec.{...}` in our config schema.
7. Tests: mock the SDK's `ThreatListener` and assert our payloads are correct shape + valid HMAC.

### 5.2 Activities — Community engine (in-tree)

1. Create `packages/engine-community/` (or in-tree `src/engines/community/`).
2. **Detectors (Android, Kotlin)**:
   - `RootDetector` — known binaries (`/system/bin/su`, `/sbin/.magisk/`, KernelSU paths), `getprop` flags (`ro.build.tags=test-keys`), package presence (`com.topjohnwu.magisk`, `eu.chainfire.supersu`). Confidence scoring per signal.
   - `DebuggerDetector` — `Debug.isDebuggerConnected()`, `android.os.Debug.waitingForDebugger()`, tracerpid in `/proc/self/status`.
   - `EmulatorDetector` — `Build.FINGERPRINT.startsWith("generic")`, `Build.MODEL.contains("sdk")`, QEMU props.
   - `HookDetector` — Frida default port scan (`27042`), known Frida lib names in `/proc/self/maps`, Xposed bridge class via reflection.
3. **Detectors (iOS, Swift)**:
   - `JailbreakDetector` — `/Applications/Cydia.app`, `/private/var/lib/apt/`, sandbox escape via writing to `/private/`, `dyld_image_count` walk for known libs (`MobileSubstrate.dylib`, `cynject`, `libhooker`).
   - `DebuggerDetector` — `sysctl(KERN_PROC, KERN_PROC_PID)` with `P_TRACED` flag.
   - `SimulatorDetector` — `TARGET_OS_SIMULATOR` compile flag plus runtime checks (`SIMULATOR_DEVICE_NAME`).
   - `HookDetector` — `_dyld_image_name` walk for `frida-agent`, `cynject`, `libhooker`.
4. **Schedule**: detectors run once on `start()` (synchronous batch, then emit `engineState=running`), then sample-driven for those that need it (e.g., debugger check on every `applicationDidBecomeActive`).
5. **Confidence scoring**: each detector returns `(detected: Bool, confidence: 0..1, signals: [String])`. Engine aggregates with `max` (any positive signal wins) and unions evidence.
6. **Threat-feed loader**: signed JSON bundle support — load from `assets/community-threat-feed.json` in the npm package, optionally fetch updates from a configurable URL with public-key signature verification (Ed25519 via `@noble/curves`).
7. Unit tests for each detector with both detected/clean fixtures.

### 5.3 Activities — Engine registry

1. `EngineRegistry` (Kotlin, Swift) — `register(Engine)`, `start(config)` calls all engines in parallel, `stop()` waits for all.
2. **Conflation**: bus-level `combineLatestBy(threatId)` so two engines reporting `hooks` within 250ms produce a single merged event (`severity = max`, `confidence = max`, `evidence = union`, `engine = ['community','talsec']`).
3. JS-side `engines: ['community']` (default) / `['talsec']` / `['community','talsec']` honored at `start()`.

### 5.4 Deliverables

- `@guardian/engine-talsec` builds, tests green.
- Community engine builds, ≥ 6 detectors per platform, tests green.
- Conflation across engines verified by integration test (mock both, fire same threat, JS gets one).

### 5.5 Exit criteria

- Running the example app on a rooted emulator + clean device produces appropriate threat events from the community engine alone (no Talsec dependency).
- The Talsec adapter, when added, augments severity and adds Talsec-only threats (multi-instance, deviceBinding, etc.) without conflict.

### 5.6 Risks

- **Detector false positives** — community engine is the highest FP risk. Mitigation: confidence < 0.6 → severity `info`, never triggers `kill`/`lockout` policies; flagged only.
- **iOS jailbreak detection on iOS 17+** — sandbox tightening makes some classic checks unreliable. Allocate buffer time for iOS-only detector tuning.

---

## 6. Phase 4 — JS API & State Machine (Weeks 13–15)

**Goal:** The shape developers actually touch. Get this wrong and adoption stalls regardless of the native quality.

### 6.1 Activities

1. **Internal store** (`src/core/store.ts`) using `zustand` (or hand-rolled if dep-allergic):
   - State: `engineState`, `subscribers: Map<id, Filter>`, `lastEvents: ringbuffer(64)`, `policy`.
   - Actions: `attach(subId, config, getHandlers)`, `detach(subId)`, `transition(state)`.
   - Refcounting: engine `start()` only when first subscriber attaches; `stop()` when last detaches AND `stopOnUnmount` is true.
2. **`useGuardian` hook**:
   - Stable `subId` via `useState(() => crypto.randomUUID())`.
   - Latest-handlers ref pattern: `const handlersRef = useRef(opts); handlersRef.current = opts;`.
   - `useEffect(() => store.attach(subId, cfg, () => handlersRef.current), [subId, hashConfig(config)])`.
   - Returns a stable `GuardianHandle`.
3. **`useThreatHandler<Id>` hook** — type-narrowed handler for a single threat id; uses the same store but with a filter.
4. **`useThreatActions(actions)`** — back-compat shape for freerasp-rn migrators.
5. **Imperative `guardian` namespace** — for non-React callers (CLI tools, background tasks).
6. **Response policy engine** (`src/core/policy.ts`):
   - `telemetry`: no-op (just routes to telemetry adapters).
   - `restrict`: emits a `RestrictEvent` consumed by host's navigator (host wires a top-level listener).
   - `lockout`: triggers configured `redirectTo` route; clears in-memory secrets via host callback.
   - `kill`: telemetry beacon + `setTimeout(() => exit(), gracePeriodMs ?? 1000)` — never `abort()`.
7. **Telemetry adapter system** (`src/core/telemetry.ts`):
   - Adapter type: `(event: ThreatEvent) => void | Promise<void>`.
   - Built-in: `sentry`, `datadog`, `firebase`. Each behind an opt-in import to keep bundle small.
   - Backpressure: queue with conflation by `(threatId, severity)` within 250ms; drop-newest if queue > 100.
8. **TS public API** finalised — all types from `src/codegen/` re-exported.
9. **Detox e2e**: example app uses `useGuardian` with `policy: 'restrict'`, fires a synthetic threat from native via a debug-only method, asserts the restrict navigation occurs.

### 6.2 Deliverables

- All public hooks shipped & typed.
- Policy engine integration test green.
- Adapter examples for Sentry + Datadog work in the example app.

### 6.3 Exit criteria

- A consumer can write 10 lines of code, get a working RASP integration with restrict-policy, and ship it.
- No `eslint-disable react-hooks/exhaustive-deps` anywhere in `src/`.

### 6.4 Parallel track

- Begin drafting `docs/api-reference.md` from the actual TypeScript types (typedoc).

---

## 7. Phase 5 — Platform Polish (Weeks 16–18)

**Goal:** Production-grade behaviour on every iOS/Android edge case the proposal called out.

### 7.1 iOS multi-scene awareness

1. Refactor `ScreenProtector` into `SceneAwareScreenProtector` keyed by `UISceneSession.persistentIdentifier`.
2. Add `sceneId?: string` parameter to `blockScreenCapture` and `isScreenCaptureBlocked`.
3. `nil sceneId` → apply to all connected scenes (default).
4. Test on Mac Catalyst, iPad split-view, and a multi-window iPad app.

### 7.2 Android API 34/35 screen capture

1. Port the existing `ScreenProtector.kt` from freerasp-rn (it's solid).
2. Improve: register against **all** activities the React context tracks, not just the main one (the freerasp-rn version delegates to host integration guide; we automate it).
3. Test on Android 14 + 15 emulator with `DETECT_SCREEN_CAPTURE` / `DETECT_SCREEN_RECORDING` permissions.

### 7.3 Encrypted external-ID storage

1. iOS: Keychain `kSecClassGenericPassword` with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
2. Android: `EncryptedSharedPreferences` with `MasterKey.Builder(context).setKeyScheme(AES256_GCM).build()`.
3. Migration path: on first call, detect plaintext `UserDefaults`/`SharedPreferences` value (from a freerasp-rn install), copy into secure store, delete plaintext. Mark migration done with a flag.
4. Tests: read-after-write, persistence across app restart, deletion.

### 7.4 Lifecycle robustness

1. Replace lateinit var listener pattern entirely — `ThreatBus` is a `SharedFlow`, dispatchers are stateless.
2. Background-foreground transitions correctly resume / pause the engine (engine-by-engine; community engine pauses periodic checks, Talsec adapter delegates).
3. Multi-process Android (`:remote` services) — bus uses `MutableSharedFlow.broadcastIn(processScope)`; document the constraints.

### 7.5 Performance budget

1. Run perf benchmark suite from P2 against the full v1.0 surface.
2. Cold-start overhead: target < 30 ms before first frame on a Pixel 6 release build.
3. Memory: target < 6 MB resident.
4. If over budget, defer non-critical detectors to a `setTimeout(0)`-style post-frame queue.

### 7.6 Deliverables

- All edge cases covered with regression tests.
- Performance report meets SLOs from §8 of the proposal.

### 7.7 Exit criteria

- A green run on the full CI matrix (3 RN versions × 3 iOS × 4 Android) with the example app.
- No P0/P1 bugs open from internal dogfooding (we run our own test fleet + 3-5 willing alpha partners during this phase).

---

## 8. Phase 6 — Compat & Migration (Weeks 19–20)

**Goal:** A consumer of `freerasp-react-native` swaps the import and is done.

### 8.1 Activities

1. **Compat shim** (`src/compat/freerasp-rn.ts`):
   - Re-export the original public API (`useFreeRasp`, `addToWhitelist`, `blockScreenCapture`, etc.).
   - Internally translate `TalsecConfig` → `GuardianConfig`, force `engines: ['talsec']`, map each `ThreatEventActions` callback via `onThreat` dispatch.
   - Guarantee the **exact same** behaviour for the 22-threat surface (no severity surfacing, no evidence — preserve the original fire-and-forget semantics).
2. **Drop-in test app** (`example-freerasp-compat/`):
   - Copy of freerasp-rn's example, but with `import { useFreeRasp } from 'guardian-rn/compat/freerasp-rn'`.
   - Passes the same scripted UI test as the original example (tap buttons, fire synthetic threats, assert UI transitions).
3. **Migration docs** (`docs/adopting-from-freerasp.md`):
   - Step 1: replace dependency.
   - Step 2: optionally adopt severities/evidence by switching to `useGuardian`.
   - Step 3: enable community engine alongside Talsec for defence-in-depth.
   - Side-by-side code samples.
4. **Compatibility CI job**: runs the freerasp-rn example app suite against `guardian-rn` compat shim. Failures block release.

### 8.2 Deliverables

- Working compat shim, tested against freerasp-rn 4.5.x behaviour.
- Migration guide with copy-paste-able diffs.

### 8.3 Exit criteria

- A blind test: hand the migration guide to an engineer who has never touched the codebase; they migrate a freerasp-rn app to guardian-rn in < 30 minutes.

---

## 9. Phase 7 — Hardening & Docs (Weeks 21–23)

**Goal:** Ship it without shame.

### 9.1 Test coverage push

1. JS unit (Jest): aim ≥ 85% line; cover the verifier, store, policy engine, telemetry adapters.
2. Kotlin (JUnit + Robolectric for the Android module surface): ≥ 70% line; cover dispatchers, engines, screen-protector, encrypted storage.
3. Swift (XCTest): ≥ 70% line; cover dispatchers, engines, scene-aware screen protector, Keychain-backed external ID.
4. E2E (Detox): smoke test for `useGuardian`, restrict policy, lockout policy, telemetry adapter.
5. **Fuzzing the verifier** with random envelope mutations (1M cases) — must reject 100%.

### 9.2 Threat-model finalisation

1. External security review of `docs/threat-model.md` (independent firm, ~1 week engagement).
2. Address findings; cut a v1.0 of the threat model.
3. Publish to repo + dedicated docs page.

### 9.3 Documentation

1. **API reference** generated by typedoc → published to GitHub Pages via CI.
2. **Engines reference** (`docs/engines.md`) — what each engine detects, on which platforms, with what confidence.
3. **Policy recipes** (`docs/policy-recipes.md`):
   - "Banking app: lockout on hook detection, restrict on debug, telemetry on root."
   - "Game: telemetry only; never block; ship anomalies to Datadog."
4. **Migration guide** (already drafted in P6, polished here).
5. **Operational runbook** (`docs/runbook.md`) — incident response, false-positive triage, threat-feed update cadence.

### 9.4 Supply-chain hardening

1. Sign npm releases (provenance attestation via OIDC + GitHub Actions).
2. Sign Android/iOS binaries (sigstore for Android, Apple notarisation for iOS).
3. SBOM generation in CI.
4. Dependabot + manual review on every patch.
5. `SECURITY.md` with private-disclosure mailbox, PGP key, response SLA (72h ack, 30d patch).

### 9.5 Deliverables

- Coverage targets met.
- Final threat model published.
- docs.guardian-rn.dev (or equivalent) live on GitHub Pages.
- Signed-release pipeline operational.

### 9.6 Exit criteria

- Code freeze. Only P0 fixes accepted from here to GA.

---

## 10. Phase 8 — Beta → GA (Weeks 24–26)

**Goal:** Ship with confidence; absorb real-world feedback before locking the API.

### 10.1 Beta (Weeks 24–25)

1. Tag `v1.0.0-beta.1`, publish to npm under `next` dist-tag.
2. Public announcement: blog post, RN community, /r/reactnative, mobile security mailing lists.
3. **Onboard 5–10 design-partner apps** (under NDA where needed). Targets:
   - 1 fintech (large)
   - 1 fintech (small/startup)
   - 1 healthcare
   - 1 gaming
   - 1 DTC retail
4. Triage incoming bugs in a public board. Cap accepted feature requests for v1.0; defer the rest to v1.1.
5. Two iterations: `beta.1` → `beta.2` (Week 24 end) → `rc.1` (Week 25 end).

### 10.2 GA (Week 26)

1. Tag `v1.0.0`. Promote to `latest` on npm.
2. Sign release. SBOM published. CHANGELOG finalised.
3. Public landing page goes live.
4. Conference / community announcements (App.js / RN-community-meetup / 42matters).
5. **First 30-day SLO** declared in `SECURITY.md`: any P0 vuln patched within 7 calendar days.

### 10.3 Deliverables

- Signed `v1.0.0` on npm with provenance attestation.
- Public docs site.
- Roadmap for v1.1+ published (next-up items below).

### 10.4 Exit criteria

- Three design partners running in production for ≥ 1 week with no reported P0/P1 issues.

---

## 11. Post-GA Roadmap (v1.1+ — out of scope for this plan)

Recorded for completeness; pulled into the public roadmap during P8.

- **Promon adapter** (`@guardian/engine-promon`).
- **AppiCrypt-style server-side attestation** as `@guardian/attest-server` (Node + signed token verification).
- **Protobuf bridge format** behind a feature flag for high-volume apps.
- **WebAssembly community engine** for shared detection logic across React Native, Cordova, and web (for hybrid apps).
- **JSI sync `getLastThreats(filter)`** for app cold-start checks before any UI renders.
- **Native module for `react-native-windows` and `react-native-macos`** (low priority; demand-driven).

---

## 12. RACI

| Workstream | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Schemas, codegen | Senior Eng A | Tech Lead | Security advisor | PM, all eng |
| TurboModule + JSI | Senior Eng B | Tech Lead | RN core community | PM |
| HMAC bridge | Senior Eng A | Tech Lead | Security advisor (P2 review gate) | PM |
| Talsec adapter | Senior Eng B | Tech Lead | Talsec contact (if reachable) | PM |
| Community engine | Senior Eng A | Tech Lead | Security advisor (detector review) | PM |
| JS API & policies | Senior Eng B | Tech Lead | Design partners (P8) | PM |
| Tests, perf, docs | SDET (part-time) | Tech Lead | All eng | PM |
| Release, supply chain | Tech Lead | PM | Security advisor | All eng, design partners |

---

## 13. Resourcing & Budget

- **2 senior engineers** — full time, ~26 weeks each.
- **1 SDET** — part time (50%), starts P3, ramps to full time in P7.
- **1 PM** — 20% time across, ramps to 50% during P8.
- **Security advisor** — 5 days at P0/P2 review gates, 5 days at P7 threat-model audit.
- **Cloud / infra**:
  - GitHub org (private repo until P8, then public).
  - GitHub Actions minutes (~5k min/mo at peak; budget for self-hosted runners if iOS builds dominate).
  - Test devices: 2× Android (Pixel 6, mid-range Samsung), 2× iOS (iPhone 13, iPad Air), all on rotation.
- **Total fully-loaded estimate**: 2.4 FTE × 6 months ≈ 14.4 person-months, plus ~10 days advisor + infra + devices.

---

## 14. Decision Gates

These are the points where the project stops if the answer is "no":

| Gate | When | Question |
|---|---|---|
| **G-Schema** | End of P0 | Are the schemas frozen and producing valid codegen on all three targets? If no, slip P1. |
| **G-JSI** | End of P1 | Does the no-op TurboModule install and call from JS on both platforms in new arch? If no, slip P2; reconsider RN baseline. |
| **G-HMAC** | End of P2 | Do all 4 tampering tests pass? Is p99 latency under target? If no, **stop** and consult security advisor before P3. |
| **G-Engines** | End of P3 | Do both engines emit valid signed events for at least the parity threat set? If no, slip P4; cut scope (drop community engine to v1.1, ship Talsec-only at GA). |
| **G-API** | End of P4 | Does design partner #1 successfully integrate `useGuardian` in a 1-day pairing session? If no, simplify the API. |
| **G-Compat** | End of P6 | Does the compat shim pass the freerasp-rn example app suite verbatim? If no, **stop** P7 and fix; compat is a release-blocker. |
| **G-Audit** | End of P7 | Does the external security review come back clean (no high/critical findings)? If no, do not GA; remediate first. |

---

## 15. What we are explicitly NOT doing in v1.0

To keep scope honest:

- **No Windows / macOS RN target** — those communities are small; demand-driven later.
- **No browser fallback for hybrid apps** — separate product line.
- **No backend-side AppiCrypt equivalent** — out of scope; v1.1 candidate.
- **No machine-learning-based anomaly detection** — interesting, but unproven and would dwarf the security review surface.
- **No automatic bypass-tool signature crawling pipeline** — community engine ships with manually curated signatures; automation is v1.1.
- **No public threat-feed CDN** — host-supplied URL only at v1.0 (we don't operate the CDN ourselves yet).

---

## 16. TL;DR — The Ladder

1. **P0 (2w)** — Freeze schemas, scaffold codegen.
2. **P1 (3w)** — Empty TurboModule on both platforms, codegen wired.
3. **P2 (3w)** — JSI host-object + HMAC-signed bridge, tampering tests green.
4. **P3 (4w)** — Talsec adapter + community engine, both emit events.
5. **P4 (3w)** — `useGuardian` hook, refcounted store, response policies, telemetry adapters.
6. **P5 (3w)** — Multi-scene iOS, encrypted storage, screen capture, perf budget.
7. **P6 (2w)** — Compat shim for freerasp-rn, migration guide.
8. **P7 (3w)** — Test coverage, threat-model audit, docs, supply-chain hardening.
9. **P8 (3w)** — Beta with design partners, then `v1.0.0` GA.

**Total: ~26 weeks (6 months) with 2 seniors + 1 SDET + 1 PM.**

Each phase has a hard exit criterion and a decision gate; failing one stops the project rather than letting tech debt compound. The two highest-risk phases are **P2 (JSI/HMAC)** and **P7 (audit)** — if either gate fails, the slip is large enough to warrant re-planning, not just absorbing into the next phase.
