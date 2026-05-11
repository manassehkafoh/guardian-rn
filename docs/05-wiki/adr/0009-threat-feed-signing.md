---
title: "ADR-0009: Threat-feed signing scheme (Ed25519, key rotation)"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0009: Threat-feed signing scheme (Ed25519, key rotation)

## Status
Accepted (2026-05-10).

## Context
The guardian-rn community engine consumes a **threat feed** — a periodically updated bundle containing:
- New and updated exclusion rules (`.exclusion.json` files).
- New threat-detection signatures for known bypass tools.
- Confidence-threshold adjustments for known FP patterns.

The feed is distributed out-of-band from the SDK (i.e., the app does not need a new App Store release to receive updated detection logic). This is a powerful capability that also introduces a supply-chain risk: an attacker who compromises the feed distribution channel could push a feed bundle that silently disables all detection.

The feed signing scheme must ensure:
1. A feed bundle can only be published by the `guardian-rn` team's signing key.
2. SDK clients can verify the signature without trusting the distribution server.
3. Signing keys can be rotated without a SDK release.
4. A compromised signing key can be revoked and replaced.

## Decision

### Algorithm: Ed25519

**Ed25519** (Edwards-curve Digital Signature Algorithm over Curve25519) is used to sign feed bundles.

Rationale:
- Compact signatures (64 bytes) and public keys (32 bytes) — suitable for embedding in the SDK binary.
- Fast verification on mobile CPUs (≈ 0.1 ms on a mid-range Android device).
- Deterministic: no random nonce required, eliminating the CSPRNG-quality concern that affected the freerasp-rn iOS `Int.random(in:)` (W8 in the weakness analysis).
- Widely supported: `libsodium` on Android/iOS; `@noble/ed25519` in Node.js.
- No patent concerns.

RSA-PSS and ECDSA P-256 were considered (see alternatives).

### Key hierarchy

```
Root signing key (offline, HSM)
  └── Intermediate signing key (online, short-lived)
        └── Feed bundle signature
```

- **Root key:** Generated and stored in an HSM (e.g., AWS CloudHSM or a YubiKey HSM). Never used to sign feed bundles directly. Used only to sign intermediate keys. Private key never leaves the HSM.
- **Intermediate key:** Generated quarterly by the security team, signed by the root key, valid for 90 days. Used by the automated feed-publishing pipeline to sign bundles. Stored in the CI/CD secrets manager (e.g., AWS Secrets Manager). Rotated before expiry.
- **Key ID:** A `kid` field (SHA-256 of the public key, first 16 bytes, hex-encoded) identifies which key was used to sign the bundle. This allows clients to look up the correct public key from the embedded trust store without trying all keys.

### Feed bundle format

```
feed-bundle-YYYYMMDD-HHMMSS.tar.gz.sig
feed-bundle-YYYYMMDD-HHMMSS.tar.gz
```

The `.tar.gz` archive contains:
```
feed/
  manifest.json        ← version, issued-at, expires-at, kid, list of files + SHA-256
  exclusions/
    *.exclusion.json
  signatures/
    *.sig.json
```

The `.tar.gz.sig` file is the detached Ed25519 signature over the SHA-256 of the `.tar.gz` archive.

`manifest.json` format:
```json
{
  "version": "2026.05.10.1",
  "issuedAt": "2026-05-10T00:00:00Z",
  "expiresAt": "2026-05-17T00:00:00Z",
  "kid": "a3f8c2d1e4b5...",
  "files": [
    { "path": "exclusions/mdm-hooks.exclusion.json", "sha256": "..." },
    ...
  ]
}
```

### SDK verification flow

1. SDK downloads the bundle and detached signature from the distribution CDN.
2. SDK looks up the `kid` in its embedded trust store (a JSON file of `kid → public-key` pairs, compiled into the binary at build time).
3. If `kid` is not found: **reject** (unknown key — possible key rollover in progress; retry after 1 hour, then alert).
4. Verify the Ed25519 signature over `SHA-256(bundle)` using the looked-up public key. **Reject on failure.**
5. Verify `manifest.issuedAt` ≤ now ≤ `manifest.expiresAt`. **Reject if expired.**
6. Verify each file's SHA-256 against the manifest. **Reject if any file is tampered.**
7. If all checks pass: apply the bundle atomically (write all files to the app's private storage in a single transaction; roll back on any write failure).

### Key rotation

**Routine rotation (quarterly):**
1. Security team generates a new intermediate key pair (Ed25519).
2. Root key signs the new intermediate public key, producing a signed key certificate.
3. The new `kid → public-key` pair is published to the SDK trust store update endpoint.
4. SDK clients download the trust store update (itself signed by the root key).
5. After a 30-day overlap period (both old and new intermediate keys are trusted), the old intermediate key is revoked.

**Emergency rotation (key compromise):**
1. Root key signs a revocation certificate for the compromised intermediate key.
2. The revocation certificate is broadcast via the SDK's trust store update channel.
3. SDKs receiving the revocation immediately reject any bundle signed with the compromised key, even if the signature is otherwise valid.
4. A new intermediate key is issued and distributed following the routine rotation procedure.

### Trust store update channel

The trust store is embedded in the SDK binary at build time. Between SDK releases, trust store updates (new keys, revocations) are distributed via a signed JSON file at a well-known URL:

```
https://feed.guardian-rn.io/.well-known/trust-store.json
```

This file is itself signed by the root key (Ed25519). The root public key is the one value that is immutable in the SDK binary. Everything else can be rotated without a release.

### Distribution CDN

Feed bundles are published to an S3-compatible CDN with:
- Object versioning enabled.
- Public `GET` access (the bundles are not secret; secrecy is enforced by the signature, not by access control).
- CloudFront or equivalent CDN for global low-latency delivery.

The SDK checks for feed updates on app foreground (at most once per 4 hours, using a `Last-Modified` conditional GET to avoid unnecessary downloads).

## Consequences
- The root key in an HSM is a dependency on the HSM provider. Loss of the HSM without backup means the root key is gone and a new root key (requiring an SDK release to update) is needed. The HSM must be backed up with offline cold-key material per the security team's key management policy.
- The 7-day `expiresAt` window means a client that is offline for more than 7 days will reject the current feed bundle on return. The SDK falls back to its compiled-in exclusion rules (never null) rather than blocking detection. A background retry fetches the latest bundle when connectivity returns.
- The trust store update channel (the `.well-known` endpoint) is the most sensitive URL in the system: a compromise allows an attacker to add their own key. This endpoint must be protected by the root key signature, and the root public key in the SDK binary must be validated during App Store review (this is a process requirement, not an SDK one).

## Alternatives considered
- **RSA-PSS-2048** — rejected; larger keys (256 bytes) and slower verification (≈ 3 ms per signature); no advantage over Ed25519 for this use case.
- **ECDSA P-256** — rejected; deterministic only with RFC 6979; less well-supported in mobile crypto libraries than Ed25519; signature size is larger (72 bytes DER vs 64 bytes Ed25519).
- **No signing (trust-on-first-use / TOFU)** — rejected; eliminates the supply-chain protection entirely; an attacker who can intercept the first download permanently owns the feed.
- **Code signing via App Store / Google Play** — rejected; feed updates must be delivered without a store release; app signing covers the binary, not runtime-fetched content.

## Links
- ADR-0007 (collector CA — same HSM infrastructure)
- ADR-0005 (exclusion rules are applied by the engine, not the policy engine)
- `packages/feed-publisher/` (build pipeline for feed bundles)
- `packages/guardian-rn/src/feed/FeedVerifier.ts`
- `packages/guardian-rn/android/.../FeedVerifier.kt`
- `packages/guardian-rn/ios/.../FeedVerifier.swift`
