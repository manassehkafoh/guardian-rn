---
title: "Lab 1 – Build the Example App"
type: tutorial
audience: all-engineers
duration: 60 min
prerequisites: Node ≥ 20, Xcode ≥ 15, Android Studio Hedgehog+, JDK 17
last_reviewed: 2026-05-10
---

# Lab 1 – Build the Example App

> **Goal:** run the `guardian-rn` example application on an iOS simulator and an Android emulator, and see live threat events arriving in the JS console.

This is the first thing every engineer does on Day 1. By the end you will have a working local build environment and a verified end-to-end path from the native SDK all the way to the JavaScript callback layer.

---

## Before you start

Confirm the following tools are installed:

```bash
node --version   # must be ≥ 20
ruby --version   # must be ≥ 3.2 (CocoaPods requirement)
java --version   # must show JDK 17
pod --version    # must be ≥ 1.14
```

If any check fails, follow the setup guide in [Engineering-Practices.md](../Engineering-Practices.md#environment-bootstrap) before continuing.

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/your-org/guardian-rn.git
cd guardian-rn
```

Expected output (last line):

```
Cloning into 'guardian-rn'... done.
```

---

## Step 2 — Install JS dependencies

```bash
npm install
```

Expected output ends with:

```
added NNN packages, and audited NNN packages in Xs
found 0 vulnerabilities
```

> If you see peer-dependency warnings about React Native version mismatches, they are safe to ignore for local development.

---

## Step 3 — Run codegen

Codegen reads `packages/schema/threat-schema.json` and writes generated artefacts to each native package.

```bash
npm run codegen
```

Expected output:

```
[codegen] ✓ TypeScript types    → packages/guardian-rn/src/generated/
[codegen] ✓ Kotlin sealed class → packages/guardian-rn/android/src/generated/
[codegen] ✓ Swift enum          → packages/guardian-rn/ios/Generated/
```

If codegen fails with a JSON parse error, run `npm run schema:validate` to locate the problem.

---

## Step 4 — Install CocoaPods

```bash
cd apps/example/ios
pod install
cd ../../..
```

Expected output ends with:

```
Pod installation complete! There are N dependencies from the Podfile and N total pods installed.
```

---

## Step 5 — Start the Metro bundler

Open a **new terminal tab** and keep it open for the rest of the lab:

```bash
npm run start --workspace=apps/example
```

Expected output:

```
Metro waiting on exp://...
```

---

## Step 6 — Run on Android

In a separate terminal:

```bash
npm run android --workspace=apps/example
```

The Android emulator will launch (if not already open). After the build completes, you will see the guardian-rn example app. Tap **"Start Guardian"**.

Expected JS console output (Metro tab):

```
[guardian] engine started — community@1.0.0
[guardian] AllChecksFinished — 0 threats detected
```

---

## Step 7 — Run on iOS

```bash
npm run ios --workspace=apps/example
```

The iOS simulator opens and runs the app. Tap **"Start Guardian"** as before.

Expected JS console output:

```
[guardian] engine started — community@1.0.0
[guardian] AllChecksFinished — 0 threats detected
```

---

## Step 8 — Trigger a simulated threat

The example app has a **"Simulate Threat"** button that injects a synthetic `debugger` event (safe for local development only):

1. Tap **"Simulate Threat → debugger"**.
2. Observe the JS console:

```
[guardian] threat received — { threatId: "debugger", severity: "high", evidence: { ... } }
[guardian] policy: telemetry — event forwarded, no restriction applied
```

3. The red threat card appears in the example UI.

---

## Step 9 — Inspect the HMAC envelope

In the Metro console, enable verbose logging:

```bash
# In a new terminal, while the app is running
npx guardian-rn debug --envelope
```

You will see a line like:

```json
{
  "seq": 1,
  "sessionId": "a3f8...",
  "hmac": "sha256=9b2c...",
  "payload": { "threatId": "debugger", ... }
}
```

The `hmac` field is the HMAC-SHA256 of the canonical-JSON payload using the per-process session key. This is what the collector verifies on ingest.

---

## Tear-down

Stop Metro (Ctrl-C), and close the simulators. No persistent state is written to disk.

---

## You should now understand

- How the monorepo workspace is structured and which commands build each layer.
- That `codegen` is a mandatory step; skipping it causes type errors in TypeScript and missing native symbols.
- The path a threat event takes: native detector → JSI bridge → HMAC envelope → JS callback.
- That the community engine emits `AllChecksFinished` when its detection pass completes — this is the heartbeat signal used by the Grafana SLO dashboard.

---

**Next lab:** [Lab 2 – Add a New Threat](Lab-2-Add-A-New-Threat.md) — extend the schema with a new threat type and see it detected end-to-end.
