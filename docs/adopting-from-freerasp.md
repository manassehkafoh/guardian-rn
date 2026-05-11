# Adopting guardian-rn from freerasp-react-native

This guide covers migrating an app that uses `freerasp-react-native` v6.x to `@guardian/rn`.

---

## Why migrate?

| | freerasp-rn | guardian-rn |
|---|---|---|
| Bridge | Legacy NativeModules | TurboModule + JSI |
| Events | 16 threat callbacks | 22 threat IDs, typed |
| Engine | Talsec-only | Pluggable (community + Talsec adapter) |
| Key delivery | N/A | One-call-only HMAC session key |
| Sequence integrity | None | Replay + gap detection |
| Policy engine | None | telemetry/restrict/lockout/kill per threat |
| React Hook | `useFreeRasp` (stale closures) | `useGuardian` (configRef pattern) |
| Telemetry | None | ELK/Grafana adapter |

---

## Step 1 — Install

```bash
npm install @guardian/rn
npm install @guardian-rn/engine-community  # open-source detector engine
```

Remove `freerasp-react-native` from your dependencies.

---

## Step 2 — Drop-in migration (fastest path)

Use `fromTalsecConfig` to convert your existing `TalsecConfig` in a single call:

```ts
import { useGuardian } from '@guardian/rn';
import { fromTalsecConfig } from '@guardian/rn/compat/freerasp-rn';
import { CommunityEngine } from '@guardian-rn/engine-community';

// Your existing freerasp config, unchanged
const talsecConfig = {
  androidConfig: { packageName: 'com.example.app', certificateHashes: ['...'] },
  iosConfig: { bundleIds: ['com.example.app'], teamId: 'TEAM123' },
  isProd: true,
  listeners: {
    privilegedAccess: () => console.warn('Root/jailbreak detected'),
    debug: () => console.warn('Debugger attached'),
    // ...your existing listeners
  },
};

// One-line migration — engines still need to be passed explicitly
const guardianConfig = fromTalsecConfig(talsecConfig, [new CommunityEngine()]);

// Replace useFreeRasp(...) with:
useGuardian(guardianConfig);
```

All 16 original freerasp listener names are mapped to the corresponding `ThreatId` actions.

---

## Step 3 — Add structured policy responses (recommended)

The `actions` shape from `fromTalsecConfig` maps listeners to per-threat callbacks. For production
apps, augment with response policies to get automatic restrict/lockout/kill behaviour:

```ts
const guardianConfig = fromTalsecConfig(talsecConfig, [new CommunityEngine()]);

// Override or extend
guardianConfig.actions.onLockout = (event) => {
  // Navigate to a lockout screen, persist state, etc.
  navigation.navigate('SecurityLockout', { threatId: event.threatId });
};
```

---

## Step 4 — Threat ID mapping reference

| freerasp listener | guardian-rn ThreatId |
|---|---|
| `privilegedAccess` | `root`, `jailbreak` |
| `debug` | `debugger` |
| `simulator` | `simulator` |
| `appIntegrity` | `repackaging`, `tamper` |
| `unofficialStore` | `unofficialStore` |
| `hooks` | `hooks` |
| `deviceBinding` | `hardwareBackedKeysMissing` |
| `passcode` | `passcodeMissing` |
| `screenshot` | `screenCapture` |
| `overlay` | `overlay` |
| `tapjacking` | `taskHijacking` |
| `systemVPN` | `systemVPN` |
| `devMode` | `devMode` |
| `adbEnabled` | `adbEnabled` |
| `malware` | `malware` |

Additional threats with no freerasp equivalent (new surface in guardian-rn):
`emulator`, `timeSpoofing`, `privilegedAccess`, `biometricMissing`, `hardwareBackedKeysMissing`, `engineFault`

---

## Step 5 — Native pod / gradle changes

### iOS

Replace the `FreeRASP` CocoaPod with `GuardianRN`:

```ruby
# Podfile — remove:
pod 'TalsecRuntime', '~> 6.0'

# Add:
# guardian-rn auto-links via react-native.config.js
```

Run `pod install`.

### Android

Remove the Talsec maven repository and dependency:

```groovy
// app/build.gradle — remove:
implementation 'com.aheaditec.talsec_security:TalsecRuntime-Community:+'

// guardian-rn links automatically via autolinking
```

---

## Common issues

**`useFreeRasp` was imported from `freerasp-react-native`**
Replace with `useGuardian` from `@guardian/rn`. The signature is identical (`config` object).

**My `isProd: false` config is now triggering telemetry-only for all threats**
This is intentional — `fromTalsecConfig` with `isProd: false` sets all critical threats to `telemetry`
so dev/CI runs don't falsely lock out testers. Toggle `isProd: true` for production builds.

**I need the Talsec proprietary engine**
Use `@guardian-rn/engine-talsec` (stub in this release; full adapter in Phase 7).
Pass it alongside `CommunityEngine`: `engines: [new CommunityEngine(), new TalsecEngine(talsecConfig)]`.
