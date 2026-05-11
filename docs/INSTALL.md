# guardian-rn — Complete Installation & Integration Guide

> **Version:** 1.1.0 (commit 55ab99b)  
> **Audience:** Mobile engineers, security engineers, DevOps  
> **Time to complete:** 30–60 minutes for a new React Native app

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Package installation](#3-package-installation)
4. [Android native setup](#4-android-native-setup)
5. [iOS native setup](#5-ios-native-setup)
6. [JavaScript / TypeScript wiring](#6-javascript--typescript-wiring)
7. [Telemetry adapter](#7-telemetry-adapter)
8. [Policy customisation](#8-policy-customisation)
9. [Advanced features](#9-advanced-features)
10. [Testing your integration](#10-testing-your-integration)
11. [CI / CD considerations](#11-ci--cd-considerations)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Overview

guardian-rn is a React Native Runtime Application Self-Protection (RASP) SDK.
It runs continuously inside your app and detects security threats — root, jailbreak,
debugger attachment, hook frameworks, unofficial installs, and more — then invokes
configurable policy actions (log / restrict features / lock out the user / terminate
the process).

### Architecture in one diagram

```
Your React component
      │
  useGuardian(config)
      │
      ├── PolicyEngine ←── OODAController (adaptive thresholds)
      │        │
      │   [onRestrict / onLockout / onKill callbacks]
      │
      ├── EventBus ←── HMAC verify ←── SequenceTracker
      │        │
      │   [fast-path for confidence ≥ 0.9]
      │
      ├── CommunityEngine
      │        ├── RootDetector
      │        ├── JailbreakDetector
      │        ├── DebuggerDetector
      │        ├── EmulatorDetector / SimulatorDetector
      │        ├── HookDetector
      │        ├── InstallationSourceDetector
      │        ├── PasscodeMissingDetector
      │        ├── BiometricMissingDetector
      │        └── ManagedProfileDetector
      │
      └── BehavioralBaselineEngine
               └── (observes CommunityEngine's threat stream)
```

---

## 2. Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| React Native | 0.73+ | New Architecture (JSI/TurboModules) required |
| Node.js | 18 LTS | 20 LTS recommended |
| TypeScript | 5.0+ | Strict mode recommended |
| Android `compileSdk` | 34 | `minSdk` 24+ |
| iOS Deployment Target | 16.0+ | Required for `LocalAuthentication` biometric APIs |
| Xcode | 15+ | Required for Swift 5.9 features in native modules |
| Kotlin | 1.9+ | Required for `getInstallSourceInfo` API |

### Peer dependencies

```json
{
  "react": ">=18.0.0",
  "react-native": ">=0.73.0"
}
```

---

## 3. Package installation

### Step 3.1 — Install the npm packages

```bash
# Core SDK
npm install @guardian/rn

# Detection engine (ships with community detectors)
npm install @guardian-rn/engine-community
```

> If your registry requires authentication (private npm or GitHub Packages),
> add an `.npmrc` file with your `NPM_TOKEN` before running install:
>
> ```
> //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
> @guardian:registry=https://npm.pkg.github.com
> ```

### Step 3.2 — Install CocoaPods dependencies (iOS)

```bash
cd ios && pod install && cd ..
```

---

## 4. Android native setup

### Step 4.1 — Link the native module

React Native's autolinking handles the TurboModule registration automatically
for RN 0.71+. Confirm the module appears in your build:

```bash
npx react-native info | grep guardian
```

You should see `@guardian/rn` listed. If not, add it manually to
`android/settings.gradle`:

```groovy
include ':guardian-rn'
project(':guardian-rn').projectDir = new File(rootProject.projectDir, '../node_modules/@guardian/rn/android')
```

### Step 4.2 — Add required dependencies to `android/app/build.gradle`

```groovy
dependencies {
    // Required by DeviceAuthManager (biometric detection)
    implementation "androidx.biometric:biometric:1.1.0"

    // Required by EncryptedStorageManager (PolicyStore persistence)
    implementation "androidx.security:security-crypto:1.1.0-alpha06"

    // Existing dependencies...
}
```

### Step 4.3 — Add permissions to `AndroidManifest.xml`

guardian-rn requires no special manifest permissions — all checks it performs
are read-only queries to system APIs that are available to any installed app.
No `<uses-permission>` additions are needed.

### Step 4.4 — ProGuard / R8 rules

If you use code shrinking, add these rules to `android/app/proguard-rules.pro`:

```proguard
# guardian-rn — keep all SDK classes from being renamed/removed
-keep class com.guardian.rn.** { *; }
-keepnames class com.guardian.rn.** { *; }

# Keep generated threat ID enums
-keep enum com.guardian.rn.generated.** { *; }

# Biometric manager — required at runtime by DeviceAuthManager
-keep class androidx.biometric.** { *; }
```

### Step 4.5 — Verify the native build

```bash
npx react-native run-android --mode=debug
```

Look for `[guardian] engine fault:` in the Metro/LogCat output. If you see it on
the very first launch, a detector's native module is not linked correctly. If you
see no errors, the SDK is running.

---

## 5. iOS native setup

### Step 5.1 — Confirm autolinking

```bash
npx react-native info | grep guardian
```

If not autolinked, add to your `Podfile`:

```ruby
pod 'guardian-rn', :path => '../node_modules/@guardian/rn'
```

Then run `pod install`.

### Step 5.2 — Add required frameworks in Xcode

Open `ios/YourApp.xcworkspace` in Xcode:

1. Select your app target → **General** → **Frameworks, Libraries, and Embedded Content**
2. Add (if not already present):
   - `LocalAuthentication.framework` — required by `DeviceAuthManager`
   - `Security.framework` — required by `KeychainStorageManager`

These are Apple system frameworks; no additional installation is needed.

### Step 5.3 — Swift / Objective-C bridging header

If your app uses Objective-C only, add a bridging header to allow the Swift
native modules to be called:

1. File → New → File → Header File → name it `YourApp-Bridging-Header.h`
2. In **Build Settings** → **Swift Compiler — General** → **Objective-C Bridging Header**,
   set the path to `YourApp/YourApp-Bridging-Header.h`

The header body can remain empty — it just needs to exist.

### Step 5.4 — Privacy descriptions in `Info.plist`

`DeviceAuthManager` calls `LAContext.canEvaluatePolicy` which may prompt the
system to check Face ID / Touch ID availability. Add these keys if not already
present:

```xml
<key>NSFaceIDUsageDescription</key>
<string>guardian-rn checks whether Face ID is enrolled to assess device security posture.</string>
```

### Step 5.5 — Verify the iOS build

```bash
npx react-native run-ios
```

No red boxes or native crashes on the first launch indicates the native modules
are linked correctly.

---

## 6. JavaScript / TypeScript wiring

### Step 6.1 — Minimum viable integration

Place `useGuardian` as high in the component tree as possible — typically in
your root `App` component or your top-level navigator. It must be inside a
React component (it uses `useEffect` and `useRef` internally).

```tsx
// App.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useGuardian } from '@guardian/rn';
import { CommunityEngine } from '@guardian-rn/engine-community';

const engine = new CommunityEngine();

export default function App() {
  useGuardian({
    tenantId: 'your-tenant-id',   // from the guardian-rn dashboard
    engines: [engine],
    actions: {
      onRestrict: (event) => {
        console.warn('[security] restricted:', event.threatId, event.confidence);
        // Degrade features here — e.g. disable high-value transfers
      },
      onLockout: (event) => {
        console.error('[security] lockout:', event.threatId);
        // Navigate to a "session blocked" screen
      },
      onKill: (event) => {
        console.error('[security] kill:', event.threatId);
        // Show a "terminated for security reasons" screen
        // The SDK will terminate the process after killPolicy.graceMs
      },
    },
  });

  return (
    <NavigationContainer>
      {/* your app */}
    </NavigationContainer>
  );
}
```

> **Important:** Construct the `CommunityEngine` instance **outside** the
> component function. Constructing it inside would create a new engine on
> every render, causing the hook to restart. The SDK defends against this
> (empty dep array in `useEffect`) but it wastes resources.

### Step 6.2 — Add BehavioralBaselineEngine

`BehavioralBaselineEngine` must observe `CommunityEngine`'s threat stream to
detect attack bursts. Wire it up like this:

```tsx
import { CommunityEngine } from '@guardian-rn/engine-community';
import { BehavioralBaselineEngine } from '@guardian-rn/engine-community';

// Both constructed outside the component
const community  = new CommunityEngine();
const behavioral = new BehavioralBaselineEngine({
  anomalyThreshold: 4,   // fire on 4+ threats within the window
  windowMs: 60_000,      // 60-second rolling window
});

// Wire the subscription BEFORE passing to useGuardian
behavioral.observeEngine(community);

export default function App() {
  useGuardian({
    tenantId: 'your-tenant-id',
    engines: [community, behavioral],  // order matters: community first
    actions: { /* ... */ },
  });
  // ...
}
```

### Step 6.3 — Enable kill policy (opt-in)

The kill policy is **disabled by default** — enabling it terminates the app
process after the grace period. Enable it only after validating in staging.

```tsx
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  killPolicy: {
    enabled: true,
    graceMs: 3000,   // 3 seconds: enough to flush telemetry and show a message
    warningCallback: (threatId) => {
      // Show a countdown screen here synchronously
      // This callback runs on the JS thread — keep it fast
    },
  },
  terminator: {
    // Implement TerminatorPort to control exactly how the process ends.
    // A minimal implementation that works on both platforms:
    terminate: ({ threatId, ts }) => {
      // React Native's built-in AppRegistry.registerRunnable is not an exit.
      // Use a native module for a real process exit:
      //   NativeModules.GuardianTerminator.exit()
      // For testing, a console.error is sufficient:
      console.error(`[guardian] PROCESS TERMINATED: ${threatId} at ${ts}`);
    },
  },
  actions: { onKill: (e) => { /* navigate to terminated screen */ } },
});
```

---

## 7. Telemetry adapter

To forward events to your observability backend, implement `TelemetryAdapter`:

```tsx
import type { TelemetryAdapter, SignPayload } from '@guardian/rn';

class MyTelemetryAdapter implements TelemetryAdapter {
  recordThreat(event: ThreatEvent, signPayload: SignPayload): void {
    // Sign the payload with the session key (you never hold the key directly)
    const body = JSON.stringify(event);
    const signature = signPayload(body);   // returns "sha256=<64 hex chars>"

    // Send to your backend asynchronously — buffer if needed
    void fetch('https://telemetry.yourcompany.com/guardian/threat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Guardian-Sig': signature,
        'X-Guardian-Tenant': 'your-tenant-id',
      },
      body,
    });
  }

  recordHealthTick(tick: EngineHealthTick): void {
    // Forward to your metrics pipeline (Datadog, Prometheus, etc.)
    // This is called every 30 seconds per engine
  }

  async flush(): Promise<void> {
    // Called on unmount — flush any buffered events before the process stops
  }
}

// Wire it in:
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  telemetry: new MyTelemetryAdapter(),
  actions: { /* ... */ },
});
```

> **Signature verification on the backend:**
>
> The `signPayload` closure computes `HMAC-SHA256(data, sessionKey)` using the
> per-session key. The backend cannot verify this signature directly (the session
> key never leaves the device) — use it as a tamper-evident seal to detect
> in-transit modification rather than as an authentication token. Use your normal
> API auth (mTLS, bearer tokens) for authentication.

---

## 8. Policy customisation

### Override default policies

```tsx
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  // Override specific threats — unspecified ones inherit SDK defaults
  policies: {
    emulator:    'restrict',   // default is 'telemetry' — upgrade for production
    systemVPN:   'restrict',   // default is 'telemetry' — flag VPN in fintech apps
    jailbreak:   'kill',       // default is 'lockout'   — escalate for banking apps
  },
  actions: { /* ... */ },
});
```

### Override confidence thresholds

```tsx
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  confidenceThresholds: {
    restrict: 0.6,   // default 0.5 — tighter gate for restrict
    // lockout and kill inherit defaults (0.7 and 0.9)
  },
  actions: { /* ... */ },
});
```

### Remote policy endpoint

To update policies without a new app release:

```tsx
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  // SDK fetches fresh policies from this URL on startup.
  // Falls back to encrypted device cache, then SDK defaults.
  policyEndpoint: 'https://api.yourcompany.com/guardian/policies',
  actions: { /* ... */ },
});
```

Your endpoint must return JSON matching this shape:

```json
{
  "jailbreak":  "kill",
  "hooks":      "kill",
  "emulator":   "restrict"
}
```

Only include the threats you want to override. Omitted threats inherit SDK defaults.

### OODA adaptive thresholds

Enable adaptive threshold tightening for high-security contexts:

```tsx
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  adaptiveThresholds: {
    windowMs:        60_000,  // 60-second rolling window
    escalationCount: 3,       // 3+ threats triggers escalation
    escalationFactor: 0.9,    // thresholds tighten by 10%
  },
  actions: { /* ... */ },
});
```

---

## 9. Advanced features

### Session expiry

Enforce limited-time access windows — useful for banking and healthcare apps
that must invalidate sessions after a set duration:

```tsx
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  sessionMaxAgeMs: 8 * 60 * 60 * 1000,  // 8 hours
  // sessionExpiry policy defaults to 'lockout' — override via policies: {}
  actions: {
    onLockout: (event) => {
      if (event.threatId === 'sessionExpiry') {
        navigateToLogin('Session expired — please sign in again');
      }
    },
  },
});
```

### ThreatId obfuscation

Prevent network-layer observers from learning which threats fired:

```tsx
useGuardian({
  tenantId: 'your-tenant-id',
  engines: [community],
  obfuscateThreatIds: true,
  // Outbound telemetry will carry opaque tokens instead of threat IDs.
  // Your backend must map tokens to threat IDs using the session map.
  actions: { /* ... */ },
});
```

### Battery-aware throttling

Battery-aware throttling is **automatic** — no configuration needed. When the
app moves to the background, `useGuardian` calls `engine.throttle('background')`
on all engines. CommunityEngine increases its scan interval from 30 s to 120 s.
When the app returns to the foreground, it calls `throttle('foreground')` to
restore the full scan rate.

To implement throttling in a custom engine:

```tsx
class MyEngine implements Engine {
  private pollIntervalMs = 30_000;

  throttle(mode: 'foreground' | 'background'): void {
    this.pollIntervalMs = mode === 'background' ? 120_000 : 30_000;
    this.reschedulePoll();  // reset your setInterval with the new interval
  }
  // ...
}
```

---

## 10. Testing your integration

### Step 10.1 — Trigger simulated detections

Each detector checks an environment variable to simulate a positive detection
in CI and test environments (where native modules are not available):

```bash
# Trigger root detection
GUARDIAN_SIMULATE_ROOT=1 jest

# Trigger unofficial store detection
GUARDIAN_SIMULATE_UNOFFICIAL_STORE=1 jest

# Trigger passcode missing
GUARDIAN_SIMULATE_PASSCODE_MISSING=1 jest

# Trigger biometric missing
GUARDIAN_SIMULATE_BIOMETRIC_MISSING=1 jest

# Trigger managed profile
GUARDIAN_SIMULATE_MANAGED_PROFILE=1 jest
```

### Step 10.2 — Unit test your callbacks

```tsx
import { PolicyEngine } from '@guardian/rn/src/core/policy.js';
import type { GuardianConfig } from '@guardian/rn/src/config/GuardianConfig.js';

const NOOP_SIGN = () => `sha256=${'0'.repeat(64)}`;

test('onRestrict fires on unofficial store detection', () => {
  const onRestrict = jest.fn();
  const config: GuardianConfig = {
    tenantId: 'test',
    engines: [],
    actions: { onRestrict },
  };
  const engine = new PolicyEngine(config, NOOP_SIGN);
  engine.apply({
    threatId:   'unofficialStore',
    severity:   'medium',
    confidence: 0.9,
    evidence:   { installer: 'com.unknown.store' },
    ts:         Date.now(),
    engineId:   'community@1.0.0',
  });
  expect(onRestrict).toHaveBeenCalledTimes(1);
});
```

### Step 10.3 — Run the existing test suite

```bash
cd /path/to/guardian-rn

# Run all tests (117 tests across 17 suites)
npm test

# Run with watch mode for TDD
npm test -- --watch

# Run only the security integration tests
npm test -- --testPathPattern="security"

# Run the scan-time benchmark
npm test -- --testPathPattern="scan-benchmark"
```

### Step 10.4 — On-device smoke test checklist

After integrating into your app, perform these manual checks on a real device:

| Check | Expected result |
|---|---|
| Install app via official store | No unofficial store detection fires |
| Enable developer mode on Android | `devMode` telemetry event logged |
| Enable ADB on Android | `adbEnabled` telemetry event logged |
| Remove device PIN | `passcodeMissing` → restrict callback fires |
| Attach Xcode debugger to release build | Debugger detection fires with high confidence |
| Run app in iOS Simulator | Simulator detection fires; policy = 'telemetry' |

---

## 11. CI / CD considerations

### Environment variables to set in CI

```yaml
# .github/workflows/test.yml
env:
  NODE_ENV: test
  # Do NOT set GUARDIAN_SIMULATE_* here — only in jobs that explicitly
  # test detection paths. Setting them globally will cause normal integration
  # tests to behave unexpectedly.
```

### Building for release

guardian-rn includes the following in release builds:
- All native TurboModules linked and stripped of debug symbols
- Generated Kotlin/Swift artefacts compiled into the `.aar` / framework

No additional Babel plugins or Metro configuration are required.

### Minification warning

Do **not** minify `@guardian/rn` itself using tools that rename class names
(e.g. Terser with `keep_classnames: false`). The HMAC and canonical JSON
serialisation rely on stable property names for cross-platform consistency.
The engine-community package is safe to minify — it carries no cross-platform
serialisation requirements.

---

## 12. Troubleshooting

### "engine fault: TypeError: Cannot read properties of undefined (reading 'generateSessionKey')"

The `GuardianKeyProvider` TurboModule is not linked. In debug builds this
falls back to `Math.random()` automatically. For production:

1. Run `pod install` (iOS) or `./gradlew assembleDebug` (Android) to force relinking.
2. Confirm the module appears in `NativeModules` from the JS console:
   ```js
   const { NativeModules } = require('react-native');
   console.log(Object.keys(NativeModules));  // should include 'GuardianKeyProvider'
   ```

### "HMAC_MISMATCH — seq N" in fault handler

This fires when an envelope arrives signed with a key that does not match the
current session key. Common causes:

- A hot-reload or fast-refresh replaced the component and generated a new
  session key, but a queued event from the previous session arrived after
  the new session was established. **This is benign** — fast-refresh in
  development frequently produces this. It will not occur in production.
- An attacker injected a forged event. **Check your telemetry** for patterns
  of this fault alongside other threat events.

### "All tests pass but detection is not firing on device"

1. Check that the environment variable simulation flags are NOT set in production.
2. Check that confidence is above 0.5 (the CommunityEngine confidence gate).
3. For Android, check LogCat for `[guardian]` tag entries.
4. For iOS, check the device console in Xcode for `[guardian]` output.

### Kill policy fires but the process does not terminate

The SDK invokes `config.terminator?.terminate(...)`. If no `terminator` is
configured, the SDK logs a warning but does not exit. Implement a `TerminatorPort`:

```tsx
import { NativeModules } from 'react-native';

const terminator: TerminatorPort = {
  terminate: ({ threatId }) => {
    // NativeModules.GuardianTerminator.exit() calls Process.killProcess(myPid())
    // on Android and exit(0) on iOS via a TurboModule
    NativeModules.GuardianTerminator?.exit();
  },
};
```

### Tests are slow (> 60 s)

The default Jest timeout is 5 s; the CommunityEngine tests use real timers.
Increase the timeout in `jest.config.js`:

```js
module.exports = {
  testTimeout: 30_000,
};
```

---

## Reference

| File | Purpose |
|---|---|
| `packages/schema/threat-schema.json` | Single source of truth for all domain types |
| `packages/guardian-rn/src/config/GuardianConfig.ts` | Full config interface with explanatory comments |
| `packages/guardian-rn/src/core/policy.ts` | DEFAULT_POLICIES + PolicyEngine decision flow |
| `packages/guardian-rn/src/core/ooda.ts` | OODA adaptive threshold controller |
| `packages/guardian-rn/src/bus/EventBus.ts` | HMAC verify + dedup + rate-cap + fast-path |
| `packages/guardian-rn/src/hooks/useGuardian.ts` | Primary SDK entry point |
| `packages/guardian-rn/src/policy/PolicyStore.ts` | Offline-resilient policy cache |
| `packages/engine-community/src/CommunityEngine.ts` | Default detector engine |
| `packages/engine-community/src/BehavioralBaselineEngine.ts` | Behavioral anomaly engine |
| `docs/10-product-design-v2.md` | Product-level design for all 13 improvements |
| `docs/11-solution-design-v2.md` | Architecture decisions (ADR-0011 through ADR-0023) |
| `docs/12-engineering-onboarding.md` | Learner guide — domain-by-domain walkthrough |
