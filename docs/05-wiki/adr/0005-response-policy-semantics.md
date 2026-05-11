---
title: "ADR-0005: Response policy semantics (restrict, lockout, kill, grace period)"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0005: Response policy semantics

## Status
Accepted (2026-05-10).

## Context
ADR-0001 replaced freerasp-rn's `abort()` model with four named response policies: `telemetry`, `restrict`, `lockout`, and `kill`. This ADR specifies the exact behaviour of each policy, the grace-period mechanics for `kill`, the hierarchy of tenant config vs SDK defaults, the `TerminatorPort` abstraction, and the opt-in requirements for destructive policies.

`abort()` in freerasp-rn terminates the process immediately and unconditionally when any callback is not provided. This caused accidental production outages when developers forgot to wire a callback. The replacement policies are explicit, composable, and auditable.

## Decision

### Policy definitions

| Policy | What it does | Who may configure it | Default |
|---|---|---|---|
| `telemetry` | Log the event to the telemetry adapter. No action on the app. | Anyone | Yes — all threat types default to `telemetry` |
| `restrict` | Log + call the tenant-provided `onRestrict(threatId)` callback. The callback decides what UI to show (e.g., hide sensitive screens). guardian-rn does not touch the UI. | Anyone | No |
| `lockout` | Log + call `onLockout(threatId)`. Intended for blocking the user from proceeding (e.g., show a "device not trusted" screen and disable navigation). guardian-rn does not navigate or render. | Anyone | No |
| `kill` | Log + call `onKill(threatId)` + after the grace period, call `TerminatorPort.terminate()`. Process termination occurs through the registered `Terminator`. | Opt-in only (explicit flag in `GuardianConfig`) | No |

### Policy assignment

Policies are assigned per `threatId` in `GuardianConfig.policies`:

```typescript
policies: {
  root:           'lockout',
  jailbreak:      'lockout',
  debugger:       'restrict',
  hooks:          'restrict',
  tamper:         'lockout',
  emulator:       'telemetry',   // informational only by default
  malware:        'lockout',
  screenCapture:  'telemetry',
  timeSpoofing:   'telemetry',
  // any unspecified threatId falls back to 'telemetry'
}
```

An unrecognised `threatId` (e.g., from a future engine version) always defaults to `telemetry`. The policy engine never throws or terminates on an unknown threat.

### Confidence threshold gating

Before executing any policy, the policy engine checks the event's `confidence` against the per-policy threshold in `GuardianConfig.confidenceThresholds`:

```typescript
confidenceThresholds: {
  restrict:  0.70,   // default
  lockout:   0.85,   // default
  kill:      0.95,   // default; lower values are rejected by schema validation
}
```

If `confidence < threshold[policy]`, the event is downgraded to `telemetry`. This is the primary lever for FP mitigation (see Lab 6) and must not be confused with disabling detection.

### `kill` opt-in requirements

To configure any threat to `kill`, the following must all be true in `GuardianConfig`:

```typescript
{
  killPolicy: {
    enabled: true,            // explicit boolean opt-in
    graceMs: 3000,            // must be ≥ 1000 ms; SDK enforces minimum
    warningCallback: (id) => void,  // called immediately; must show UI warning
  }
}
```

If `killPolicy.enabled` is `false` (the default), any `kill` assignment in `policies` is silently downgraded to `lockout`. This prevents misconfiguration from causing unexpected termination.

### Kill grace period

The kill sequence:

1. `onKill(threatId)` callback is called immediately on the JS thread. The app should display a "device compromised" message.
2. `killPolicy.warningCallback(threatId)` is called on the native thread simultaneously.
3. After `killPolicy.graceMs` (≥ 1000 ms), `TerminatorPort.terminate()` is called.
4. If `onKill` calls `guardian.deferKill(additionalMs)` within the grace period, termination is deferred once by `additionalMs` (max 10 000 ms). This allows the app to flush analytics or perform a clean logout before termination.
5. `TerminatorPort.terminate()` is the only place in `guardian-rn` that terminates the process.

### TerminatorPort

```typescript
interface TerminatorPort {
  terminate(reason: TerminationReason): void;
}
```

The default implementation calls `android.os.Process.killProcess` / `Foundation.exit(1)`. A custom `TerminatorPort` can be injected via `GuardianConfig.terminator` — this is used in tests to assert that termination was triggered without actually killing the test process.

There is deliberately no `TerminatorPort` implementation in the SDK's test helpers that suppresses termination silently; it must be injected explicitly so that tests that expect termination cannot accidentally pass if the implementation changes.

### Policy execution on the main thread

All policy callbacks (`onRestrict`, `onLockout`, `onKill`) are called on the JS main thread (React Native's JS thread). They must not perform blocking I/O. `TerminatorPort.terminate()` is called on a dedicated `guardian-terminator` background thread to ensure the termination syscall fires even if the JS thread is hung.

### Audit log

Every policy execution writes a `guardian.policy` field to the ECS document:

```json
{
  "guardian.policy.name": "lockout",
  "guardian.policy.executedAt": 1715350800000,
  "guardian.policy.confidenceAtExecution": 0.92,
  "guardian.policy.killDeferred": false
}
```

This is the audit trail for compliance and incident review.

## Consequences
- Developers who previously relied on `abort()` firing automatically must now explicitly configure a `lockout` or `kill` policy. This is intentional friction — destructive actions require deliberate configuration.
- The confidence-threshold gating means a detector regression that lowers confidence scores may silently downgrade policies. Monitoring the `guardian.policy.name` distribution in Grafana (D-1) catches this drift.
- The `TerminatorPort` abstraction makes the kill policy fully testable without real process termination, removing the freerasp-rn problem where kill-path code was hard to test.
- The grace period introduces a window during which the attacker's code continues running. This is a deliberate trade-off: a 1–3 second window for user-visible feedback is acceptable; instant termination without warning causes poor UX and support tickets.

## Alternatives considered
- **`abort()` on missing callback** (freerasp-rn) — rejected; caused accidental outages; gives no audit trail; not configurable per threat.
- **Severity-based auto-escalation** (e.g., `critical` always → `kill`) — rejected; severity describes the threat, not the desired response. A `critical` threat on a developer device should be `telemetry`, not `kill`.
- **Single `onThreat` callback with a `policy` suggestion** — rejected; the SDK's responsibility is to execute the policy, not suggest it; putting the execution logic in the app layer recreates the freerasp-rn callback burden.
- **No `kill` policy at all** — rejected; regulated industries (banking, defence) have a legitimate requirement to terminate compromised sessions deterministically.

## Links
- ADR-0001 (response policies committed as baseline, `abort()` rejected)
- ADR-0004 (engine fault does not trigger kill; policy engine is separate)
- `packages/guardian-rn/src/policy/PolicyEngine.ts`
- `06-domain-driven-design-with-tdd.md` §Response-Policy bounded context
