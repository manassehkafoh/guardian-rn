---
title: "ADR-0003: HMAC algorithm and canonical-JSON serialisation"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0003: HMAC algorithm and canonical-JSON serialisation

## Status
Accepted (2026-05-10).

## Context
ADR-0001 committed to an HMAC-SHA256 envelope wrapping every threat event crossing the native↔JS bridge. This ADR specifies the exact algorithm, key size and delivery mechanism, the canonical serialisation of the payload before signing, the sequence number scheme, and the replay-detection window — all of which must be agreed before any bridge code is written.

The threat model is an attacker who can:
- Intercept and replay bridge messages from JS to native (e.g., via Frida hooking the JSI layer).
- Inject synthetic threat events from the JS side to suppress or fabricate detections.
- Observe bridge traffic and attempt to extract the session key.

The threat model explicitly excludes a fully compromised kernel; at that point the device is already owned and no HMAC scheme helps.

## Decision

### Algorithm

**HMAC-SHA256** with a **256-bit (32-byte) session key**.

Rationale: SHA-256 is universally available on Android Keystore (API 23+) and iOS Secure Enclave / CommonCrypto without third-party dependencies. 256-bit keys provide 128-bit collision resistance. HMAC-SHA384/512 were considered unnecessary for the threat model and add latency on low-end Android devices.

### Session key delivery

1. On native `start()`, the native module generates a fresh 256-bit key using:
   - **Android:** `KeyGenerator` backed by Android Keystore with `HMAC-SHA256` purpose. The key never leaves the Keystore hardware boundary.
   - **iOS:** `SecKeyGenerateSymmetric` with `kSecAttrKeyTypeHMAC` stored in the Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
2. The key is delivered to JS exactly once, synchronously, via the JSI HostObject method `getSessionKey()`. The return value is a `Uint8Array` held in JS memory for the session lifetime.
3. `getSessionKey()` may only be called once per process lifetime. A second call throws `GuardianError.sessionKeyAlreadyDelivered`. This prevents key re-extraction via repeated calls.

### Canonical JSON serialisation (RFC 8785 JCS)

The payload is serialised using [JSON Canonicalisation Scheme (RFC 8785)](https://www.rfc-editor.org/rfc/rfc8785) before signing:
- Object keys are sorted lexicographically (Unicode code-point order).
- No insignificant whitespace.
- Numbers use the shortest IEEE 754 representation.
- Strings use Unicode escape sequences where required.

This is implemented in:
- **TS/JS:** `@guardian/jcs` (thin wrapper around the `canonicalize` npm package, pinned to a specific SHA).
- **Kotlin:** `JcsSerializer.kt` (hand-written, unit-tested against the RFC 8785 test vectors).
- **Swift:** `JCSEncoder.swift` (hand-written, same test vectors).

The implementation for all three targets must pass the 48 test vectors from the RFC 8785 appendix before merging. This is a CI gate.

### Envelope structure

```typescript
interface GuardianEnvelope {
  seq: number;           // monotonic uint32, per-session
  sessionId: string;     // UUID v4, generated once on native start()
  ts: number;            // Unix epoch ms (device clock)
  hmac: string;          // "sha256=<hex>", HMAC over canonical(payload)
  payload: ThreatPayload;
}
```

The HMAC covers only the `payload` field serialised via JCS. `seq`, `sessionId`, `ts`, and `hmac` are transport fields and are not included in the signed surface — they are integrity-checked by the collector at the batch level (mTLS transport + batchId idempotency).

### Sequence number

- Type: `uint32`, starting at `1`, incrementing by `1` per event.
- Rollover: at `0xFFFFFFFF`, the engine triggers a session re-key (calls `NativeGuardianRN.restart()` internally). This is expected to never occur in practice (> 4 billion events per session).
- Gap detection: the collector flags any `seq` gap > 1 between consecutive events in the same `sessionId` as a potential drop event (alert A-4). A gap of exactly `0xFFFFFFFF - last_seq` indicates a rollover; this is not flagged.

### Collector verification

The collector (`packages/collector`) re-computes the HMAC server-side using the session key it received during the session handshake (`POST /session`). Any event with a non-matching HMAC sets `guardian.envelope.verified: false` in the Elasticsearch document and triggers alert A-3 (SEV-1). The event is still stored for forensic purposes but the `guardian.policy` field is set to `quarantine` and no response policy is executed.

## Consequences
- The Android Keystore-backed key means the HMAC cannot be computed on devices running API < 23. The SDK minimum is API 24 (ADR-0001), so this is not a constraint in practice.
- JCS implementations in three languages add maintenance surface; the RFC 8785 test-vector CI gate reduces regression risk.
- The one-call restriction on `getSessionKey()` means a JS crash that reloads the JS bundle mid-session cannot re-acquire the key without a full native restart. This is intentional: session continuity is a security property, not a convenience feature.
- The `ts` field uses the device clock, which may be spoofed (hence the `timeSpoofing` detector). The collector records both `ts` (device) and `@timestamp` (ingest time); forensic analysis can compare them.

## Alternatives considered
- **HMAC-SHA512** — rejected; no material security gain for the threat model; measurable latency increase on low-end Android.
- **ECDSA signature per event** — rejected; asymmetric signing is 10–50× slower per operation, making it unsuitable for high-frequency event streams.
- **Random IDs only (freerasp-rn approach)** — rejected per ADR-0001; insufficient against an attacker who can observe and replay bridge messages.
- **AES-GCM encryption** — rejected; confidentiality of the bridge is not a requirement (events are already sent to the collector over mTLS); integrity is the requirement.
- **Custom canonicalisation** — rejected; RFC 8785 JCS is a published standard with a test-vector suite; a custom scheme would have no such validation.

## Links
- ADR-0001 (HMAC committed as baseline)
- ADR-0007 (collector trust boundary — session handshake)
- RFC 8785: https://www.rfc-editor.org/rfc/rfc8785
- `packages/guardian-rn/src/jsi/GuardianHostObject.ts`
- `packages/guardian-rn/android/.../HmacEnvelope.kt`
- `packages/guardian-rn/ios/.../HMACEnvelope.swift`
