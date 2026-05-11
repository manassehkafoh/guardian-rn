# Policy Recipes

guardian-rn's `PolicyEngine` applies a `ResponsePolicy` per `ThreatId`.
This page shows common real-world configurations.

---

## Default policies

The PolicyEngine ships with sensible defaults (see `core/policy.ts`):

| ThreatId | Default policy |
|---|---|
| `hooks`, `tamper`, `repackaging` | `kill` |
| `root`, `jailbreak`, `malware`, `taskHijacking`, `privilegedAccess` | `lockout` |
| `debugger`, `screenCapture`, `timeSpoofing`, `overlay`, `passcodeMissing`, `hardwareBackedKeysMissing`, `unofficialStore` | `restrict` |
| `emulator`, `simulator`, `systemVPN`, `devMode`, `adbEnabled`, `biometricMissing`, `engineFault` | `telemetry` |

---

## Recipe 1 — Finance app (strict)

Block users who are on rooted/jailbroken devices outright.

```ts
const config: GuardianConfig = {
  tenantId: 'acme-bank',
  engines: [new CommunityEngine()],
  policies: {
    root: 'lockout',
    jailbreak: 'lockout',
    emulator: 'lockout',   // override default 'telemetry'
    simulator: 'lockout',
    debugger: 'lockout',
  },
  confidenceThresholds: { lockout: 0.7 },
  actions: {
    onLockout: (event) => navigation.navigate('SecurityBlock', { threatId: event.threatId }),
  },
};
```

---

## Recipe 2 — Gaming app (anti-cheat)

Kill the process immediately on hook detection (cheating tools), warn on root.

```ts
const config: GuardianConfig = {
  tenantId: 'acme-game',
  engines: [new CommunityEngine()],
  killPolicy: { enabled: true, graceMs: 3000, warningCallback: (id) => showAntiCheatWarning(id) },
  terminator: { terminate: (reason) => exitProcess(reason.threatId) },
  policies: {
    hooks: 'kill',
    root: 'restrict',
    debugger: 'restrict',
  },
  actions: {
    onRestrict: (event) => disableNetworkPlay(event),
    onKill: (event) => saveGameStateBeforeExit(event),
  },
};
```

---

## Recipe 3 — Development / CI (observe only)

All threats downgraded to telemetry so QA runs on emulators without lockouts.

```ts
const config: GuardianConfig = {
  tenantId: 'dev',
  engines: [new CommunityEngine()],
  policies: Object.fromEntries(
    (['root','jailbreak','debugger','hooks','tamper','emulator','simulator'] as ThreatId[])
      .map((id) => [id, 'telemetry' as ResponsePolicy])
  ),
  actions: {},
  telemetry: myLogger,
};
```

Or use the freerasp compat helper which does this automatically:
```ts
fromTalsecConfig({ ...talsecConfig, isProd: false }, [new CommunityEngine()])
```

---

## Recipe 4 — Gradual rollout (shadow mode)

Log all threat decisions without acting, then flip to enforce after validating false-positive rates.

```ts
const config: GuardianConfig = {
  tenantId: 'acme-app',
  engines: [new CommunityEngine()],
  // Override all policies to telemetry in shadow mode
  policies: allThreatsToTelemetry(),
  actions: {},
  telemetry: {
    recordThreat: (e) => analytics.track('guardian_shadow', { ...e }),
    recordHealthTick: () => {},
    flush: async () => {},
  },
};
```

After validating in production for 2 weeks, remove the `policies` override to restore defaults.

---

## Confidence thresholds

The default confidence thresholds are:

| Policy | Default threshold |
|---|---|
| `restrict` | 0.5 |
| `lockout` | 0.7 |
| `kill` | 0.9 |

Override via `confidenceThresholds`:

```ts
confidenceThresholds: {
  restrict: 0.6,   // be less trigger-happy on restrict
  lockout: 0.8,    // require higher confidence before lockout
  kill: 0.95,      // require very high confidence before kill
}
```
