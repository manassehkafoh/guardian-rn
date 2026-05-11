# `guardian-rn` — Domain-Driven Design with TDD Embedded

> **Companion to:** `02-superior-solution-proposal.md`, `03-implementation-plan.md`, `04-observability-addendum.md`, `05-wiki/`.
> **Purpose:** The strategic and tactical DDD model for the system, with TDD discipline embedded inside each bounded context. This is the doc that determines what code goes where, what tests get written first, and what the team argues about precisely versus loosely.
> **Audience:** All engineers, especially anyone touching domain code.

This document is structured as:

1. Strategic DDD — domain, subdomains, bounded contexts, context map.
2. Ubiquitous Language — pointer to the canonical glossary.
3. Tactical DDD per Bounded Context — entities, value objects, aggregates, domain events, repositories, services.
4. **TDD discipline embedded** — each context shows red→green→refactor cycles for its core invariants.
5. Cross-cutting concerns — outside-in TDD, ATDD, property-based tests, test taxonomy.

---

## 1. Strategic DDD

### 1.1 Domain

> **The domain:** detect, attest, and respond to runtime threats against React Native mobile applications, while giving operators centralised visibility and reporting.

This domain has four faces:

- **On-device detection** (security engineering territory).
- **Application self-protection** (UX and product territory — what the app does when threatened).
- **Centralised security operations** (SecOps territory — dashboards, alerts, reports).
- **Compliance and data governance** (legal/privacy territory — residency, erasure, retention).

### 1.2 Subdomains

| Type | Subdomain | Why this classification |
|---|---|---|
| **Core** | Threat Detection | Our differentiator. Detector quality + breadth = product value. |
| **Core** | Bridge Integrity | Without it, every other guarantee is theatre. Tampering must be detectable. |
| **Core** | Response & Policy | Determines whether the product is friendly or hostile to honest users. |
| **Supporting** | Subscriber & Lifecycle | Enables fan-out, multi-instance, lifecycle correctness. Generic-feeling but bespoke to RN. |
| **Supporting** | Threat Telemetry (client) | Routes events to backends. Important; not differentiating. |
| **Supporting** | Observability Ingest (server) | Aggregation, dashboards, reporting. High value to customers; not differentiated technology. |
| **Supporting** | Reporting | Weekly digests. Pure orchestration. |
| **Supporting** | Compatibility | Migration shim from `freerasp-react-native`. Disposable in 2 years. |
| **Generic** | Configuration & Codegen | Schema → typed artefacts. Off-the-shelf-ish, but ours. |

We invest disproportionately in Core, instrument Supporting well, and resist gold-plating Generic.

### 1.3 Bounded Contexts

Eight contexts, each with a clean boundary, its own model, and its own internal language:

1. **Threat Detection** (core)
2. **Bridge Integrity** (core)
3. **Response & Policy** (core)
4. **Subscriber & Lifecycle** (supporting)
5. **Threat Telemetry — Client** (supporting)
6. **Observability Ingest — Server** (supporting)
7. **Reporting** (supporting)
8. **Compatibility** (supporting)
9. **Configuration & Codegen** (generic)

(Numbered for cross-reference; nine because Configuration is technically a context though small.)

### 1.4 Context Map

Relationships matter as much as boundaries. We use **Evans's relationship vocabulary**:

```
                          ┌──────────────────────────────────┐
                          │  Configuration & Codegen          │
                          │  (Shared Kernel, code-gen schema) │
                          └────────────────┬─────────────────┘
                                           │   provides types to all
       ┌───────────────────┬───────────────┼───────────────────┬───────────────────┐
       ▼                   ▼               ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│Threat        │——◀▶│Bridge        │  │Subscriber &  │  │Response &    │  │Compatibility │
│Detection     │    │Integrity     │◀▶│Lifecycle     │◀▶│Policy        │  │(ACL)         │
│              │ produces SignedEnvelopes  │              │  │              │  │              │
└──────┬───────┘    └──────┬───────┘  └──────────────┘  └──────────────┘  └──────────────┘
       │ consumed by                       │ via store                  │
       ▼                                   ▼                            ▼
┌──────────────┐                   ┌──────────────┐               ┌──────────────┐
│Threat        │                   │ Host App     │               │ legacy       │
│Telemetry     │                   │ (downstream) │               │ freerasp-rn  │
│(Client)      │                   └──────────────┘               │ consumers    │
└──────┬───────┘                                                  └──────────────┘
       │  HTTPS / mTLS
       ▼
┌──────────────────────┐  ─partnership─▶ ┌──────────────┐ ─customer/supplier─▶ ┌──────────────┐
│Observability Ingest  │                  │ Reporting    │                       │ External CSM │
│(Server)              │                  │              │                       │ tools        │
└──────────────────────┘                  └──────────────┘                       └──────────────┘
```

Relationship types in this map:

| From → To | Relationship | Notes |
|---|---|---|
| Config → all | **Shared Kernel** | The codegen artefacts are shared, but generated, not edited. |
| Threat Detection → Bridge Integrity | **Customer / Supplier** | Detection produces events; Bridge wraps them in envelopes. Detection is upstream; Bridge dictates the envelope shape. |
| Bridge Integrity → Subscriber & Lifecycle | **Conformist** | Subscribers consume verified events as-is; they don't influence the envelope shape. |
| Subscriber & Lifecycle → Response & Policy | **Customer / Supplier** | Subscribers route to policies; policies own the response shape. |
| Threat Telemetry → Observability Ingest | **Customer / Supplier** | Client supplies; Server defines the contract (ECS). |
| Observability Ingest → Reporting | **Partnership** | They share a model (ES queries) and evolve together. |
| Compatibility → Threat Detection / Response | **Anti-Corruption Layer (ACL)** | Translates legacy `TalsecConfig` and `ThreatEventActions` shape to our internal model without leaking legacy concepts inward. |

### 1.5 The "ACL" detail (because it matters)

The Compatibility context is the **only place** where legacy `freerasp-react-native` shapes are allowed to exist. Everywhere else, the team writes against `GuardianConfig` and `ThreatEvent`. The ACL guarantees that when freerasp-rn is finally retired, we delete one package and nothing else changes.

---

## 2. Ubiquitous Language

The full glossary lives at [`05-wiki/reference/Glossary.md`](05-wiki/reference/Glossary.md) — that is the canonical source. Engineers writing code in a context **must** spell terms exactly as they appear in the glossary; tests, comments, and class names follow.

A 30-second sample for orientation:

- **Threat** ≠ Attack ≠ Alert ≠ Incident. Each has a precise meaning.
- **Session** = one `start()` lifetime. **Subscriber** = one `useGuardian` mount.
- **HMAC Envelope** = signed `(payload, sig, seq)` triple crossing the bridge.
- **Engine** ⊃ **Detectors**. Engines emit ThreatPayloads; Detectors decide.
- **Policy** = `telemetry | restrict | lockout | kill`. Never "abort".
- **Tenant** ≠ User. Tenant is a customer org; User is an end-user.
- **Erasure** is GDPR Art. 17 only; "delete" is the lower-level op.

---

## 3. Tactical DDD per Bounded Context

For each context: aggregates, entities, value objects, domain services, domain events, repositories, and a worked TDD cycle on its core invariant.

---

### 3.1 Bounded Context: **Threat Detection** (core)

**Responsibility:** Decide whether each `ThreatId` is currently true on this device; emit a `ThreatPayload` per positive decision with severity, confidence, and evidence.

#### 3.1.1 Building blocks

| Building Block | Examples | Notes |
|---|---|---|
| **Aggregate Root** | `Engine` | Owns its detectors and lifecycle. Emits to a single port: the bus. |
| **Entity** | `Detector` | Has identity (name + version), mutable state (last-run, signal-cache). |
| **Value Object** | `ThreatPayload`, `Evidence`, `Confidence`, `Severity`, `Signal` | Immutable, equality by value. |
| **Domain Service** | `ConflationStrategy` | Stateless; merges two payloads with the same `ThreatId`. |
| **Domain Event** | `DetectorRanEvent`, `EngineDegradedEvent` | Internal; not the same as `ThreatEvent` (which crosses contexts). |
| **Repository** | `ThreatFeedRepository` | Loads/refreshes signed JSON threat feed; returns immutable `Feed`. |
| **Port** | `ThreatBusPort` | The output port the Engine writes to (implemented by Bridge Integrity). |

#### 3.1.2 Invariants (the rules that must always hold)

- I-1: A `ThreatPayload` always has a `confidence` in `[0, 1]`.
- I-2: A `ThreatPayload` with `confidence < 0.6` cannot have `severity` ≥ `medium`.
- I-3: An Engine never emits a `ThreatId` outside its declared `capabilities`.
- I-4: A Detector marked `requiresPermission(p)` is skipped (with a structured log) if permission `p` is missing — never attempts to run without it.
- I-5: Conflation is associative and commutative; merging A then B equals B then A.

#### 3.1.3 TDD cycle on Invariant I-2 (confidence ↔ severity coupling)

**Red — write the failing test first** (`packages/engine-community/__tests__/threatPayload.invariants.spec.ts`):

```ts
import { ThreatPayload } from '../src/domain/ThreatPayload';

describe('ThreatPayload invariant: low confidence cannot be high severity', () => {
  it('rejects severity=high when confidence<0.6', () => {
    expect(() =>
      ThreatPayload.of({
        id: 'hooks',
        confidence: 0.5,
        severity: 'high',
        evidence: { kind: 'hooks', framework: 'unknown', signatures: [] },
      }),
    ).toThrow(/confidence below 0.6 cannot be high or critical/);
  });

  it('accepts severity=info regardless of confidence', () => {
    expect(() =>
      ThreatPayload.of({
        id: 'hooks',
        confidence: 0.1,
        severity: 'info',
        evidence: { kind: 'hooks', framework: 'unknown', signatures: [] },
      }),
    ).not.toThrow();
  });
});
```

Run: `yarn jest threatPayload.invariants` → **fails** (no class exists yet, or constructor doesn't validate). Confirm fail-for-the-right-reason.

**Green — write the smallest code that passes:**

```ts
// packages/engine-community/src/domain/ThreatPayload.ts
export class ThreatPayload {
  private constructor(private readonly props: ThreatPayloadProps) {}

  static of(props: ThreatPayloadProps): ThreatPayload {
    if (props.confidence < 0.6 && (props.severity === 'high' || props.severity === 'critical')) {
      throw new Error('confidence below 0.6 cannot be high or critical severity');
    }
    return new ThreatPayload(props);
  }

  get id() { return this.props.id; }
  get severity() { return this.props.severity; }
  get confidence() { return this.props.confidence; }
  get evidence() { return this.props.evidence; }
}
```

Run: green.

**Refactor — clean up:**

- Extract `Confidence` value object (validates `[0,1]` once, not at every use).
- Extract `Severity` as a discriminated string-literal union with a helper `Severity.canBeAtMost(severity, confidence)`.
- Move the invariant into a private `assertInvariants()` method.

Run again: still green.

**Property-based reinforcement** (after the basic test passes — inside the same Refactor step or a follow-up Red):

```ts
import fc from 'fast-check';
test('I-2 holds for arbitrary inputs', () => {
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: 1, noNaN: true }),
      fc.constantFrom('info','low','medium','high','critical' as const),
      (confidence, severity) => {
        const try_ = () => ThreatPayload.of({ id: 'hooks', confidence, severity, evidence: noEvidence });
        if (confidence < 0.6 && (severity === 'high' || severity === 'critical')) {
          expect(try_).toThrow();
        } else {
          expect(try_).not.toThrow();
        }
      },
    ),
    { numRuns: 1000 },
  );
});
```

This kind of property test is required for any Value Object whose invariants relate two fields.

#### 3.1.4 Outside-in test (acceptance level)

Gherkin in `packages/engine-community/features/conflation.feature`:

```gherkin
Feature: Conflation across engines (I-5)
  Two engines reporting the same ThreatId within 250ms produce one event

  Scenario: Two engines report 'hooks' simultaneously
    Given the community engine is running
    And the talsec adapter is running
    When the community engine emits 'hooks' with severity=medium, confidence=0.7
    And the talsec adapter emits 'hooks' with severity=high, confidence=0.95 within 100ms
    Then a single ThreatEvent is delivered to JS
    And its severity is 'high'
    And its confidence is 0.95
    And its engine list contains both 'community' and 'talsec'
```

The acceptance test drives a series of unit tests in the `Conflation` domain service. We write the .feature first, fail it, then drive units.

---

### 3.2 Bounded Context: **Bridge Integrity** (core)

**Responsibility:** Sign every `ThreatPayload` crossing native→JS, verify on receipt, expose tampering as `InvariantBreach`.

#### 3.2.1 Building blocks

| Building Block | Examples |
|---|---|
| **Aggregate Root** | `Session` — owns the HMAC key + sequence counter. |
| **Value Object** | `SessionKey`, `SignedEnvelope`, `SequenceNumber`, `Hmac` |
| **Domain Service** | `EnvelopeSigner`, `EnvelopeVerifier`, `CanonicalJson` |
| **Domain Event** | `EnvelopeSignedEvent`, `VerificationFailedEvent`, `SequenceGapDetectedEvent` |
| **Port** | `KeyStorePort` (Keystore/Keychain backed) |

#### 3.2.2 Invariants

- I-6: A `Session` issues monotonically-increasing sequence numbers; never reuses a number.
- I-7: A `SignedEnvelope.sig == HMAC-SHA256(SessionKey, canonicalJson(payload) || seq)`.
- I-8: `CanonicalJson` is deterministic: equal inputs produce identical bytes.
- I-9: `EnvelopeVerifier` rejects on (a) HMAC mismatch, (b) seq ≤ lastSeen, (c) wrong key id.
- I-10: A `SessionKey` never appears in any logged string.

#### 3.2.3 TDD cycle on Invariant I-9 (verifier rejects tampered envelopes)

**Red:**

```ts
// packages/guardian-rn/src/core/__tests__/verifier.spec.ts
import { EnvelopeVerifier } from '../verifier';
import { EnvelopeSigner }   from '../signer';
import { SessionKey }       from '../sessionKey';

describe('EnvelopeVerifier', () => {
  const key = SessionKey.fromBytes(new Uint8Array(32).fill(7));
  const signer = new EnvelopeSigner(key);
  const verifier = new EnvelopeVerifier(key);
  const payload = { id: 'hooks', confidence: 0.9, severity: 'medium' as const, evidence: noEvidence };

  it('accepts a valid envelope', () => {
    const env = signer.sign(payload, 1);
    expect(verifier.verify(env, 0)).toEqual({ ok: true, payload, seq: 1 });
  });

  it('rejects when payload is tampered with', () => {
    const env = signer.sign(payload, 1);
    const tampered = { ...env, payload: { ...env.payload, severity: 'critical' } };
    expect(verifier.verify(tampered, 0)).toEqual({ ok: false, reason: 'hmac-mismatch' });
  });

  it('rejects on replay (seq <= lastSeen)', () => {
    const env = signer.sign(payload, 1);
    expect(verifier.verify(env, 1)).toEqual({ ok: false, reason: 'replay' });
  });

  it('rejects on wrong key', () => {
    const otherKey = SessionKey.fromBytes(new Uint8Array(32).fill(8));
    const env = new EnvelopeSigner(otherKey).sign(payload, 1);
    expect(verifier.verify(env, 0)).toEqual({ ok: false, reason: 'hmac-mismatch' });
  });
});
```

Run → **fails** (none of these classes exist yet). Confirm fail-for-the-right-reason.

**Green — minimum code:** implement `SessionKey`, `EnvelopeSigner`, `EnvelopeVerifier`, `CanonicalJson` to pass each case. Use `@noble/hashes` for HMAC.

**Refactor:**

- Make `EnvelopeVerifier.verify` return a discriminated union `Result<Verified, FailureReason>` so callers can't ignore the failure path.
- Extract `CanonicalJson.serialise(payload)` and write its **own** test suite ensuring `{a:1,b:2}` and `{b:2,a:1}` produce identical bytes.

**Property test** (required, not optional, for crypto code):

```ts
import fc from 'fast-check';
test('verifier round-trips arbitrary valid payloads', () => {
  fc.assert(
    fc.property(arbitraryThreatPayload(), fc.integer({ min: 1, max: 1_000_000 }), (p, seq) => {
      const env = signer.sign(p, seq);
      const result = verifier.verify(env, seq - 1);
      expect(result).toEqual({ ok: true, payload: p, seq });
    }),
    { numRuns: 5_000 },
  );
});
```

**Fuzz test** (P7 hardening):

```ts
test('verifier rejects 100% of random byte mutations', () => {
  // 1M random envelopes with random byte flips → must reject all but the unmutated one (probability of accidental valid HMAC < 2^-128)
});
```

#### 3.2.4 Cross-language vector tests

Because canonical JSON must produce the same bytes in TypeScript, Kotlin, and Swift, we ship a shared `vectors.json` with input/output pairs, and each language test suite asserts its serialiser matches. This is the *only* way to catch a subtle regression where one platform sorts strings with locale-aware comparison and another doesn't.

---

### 3.3 Bounded Context: **Response & Policy** (core)

**Responsibility:** Given a `ThreatEvent` and a `Policy`, dispatch the appropriate response.

#### 3.3.1 Building blocks

| Building Block | Examples |
|---|---|
| **Aggregate Root** | `PolicyDispatcher` |
| **Value Object** | `Policy`, `Response`, `GracePeriod` |
| **Domain Service** | `RestrictRouter`, `LockoutInitiator`, `KillTerminator` |
| **Domain Event** | `RestrictEvent`, `LockoutEvent`, `KillScheduledEvent`, `KillExecutedEvent` |
| **Port** | `NavigationPort`, `AuthPort`, `TerminatorPort` (host-supplied) |

#### 3.3.2 Invariants

- I-11: `kill` policy always emits a final telemetry beacon before terminating.
- I-12: `kill` policy never calls `abort()`; only the configured `TerminatorPort.terminate()`.
- I-13: A `restrict` response navigates only to routes registered in `policy.sensitiveScreens`. Unknown route → log + ignore.
- I-14: `lockout` clears all in-memory secrets the host registered before redirecting.
- I-15: A `custom` policy handler that throws is treated as `telemetry` (fail-safe).

#### 3.3.3 TDD cycle on Invariant I-12 (no abort)

```ts
// __tests__/policyDispatcher.spec.ts
test('kill policy invokes terminator port, never aborts', () => {
  const terminator = jest.fn().mockResolvedValue(undefined);
  const policy = { kind: 'kill', gracePeriodMs: 50 } as const;
  const telemetry = jest.fn();
  const dispatcher = new PolicyDispatcher({ terminator, telemetry });

  // Spy on global abort/process.exit
  const exitSpy  = jest.spyOn(process, 'exit').mockImplementation(((c?: number) => undefined) as any);
  const abortSpy = jest.spyOn(global,  'abort' as any).mockImplementation(() => { throw new Error('abort called'); });

  return dispatcher.dispatch(threatEvent('hooks'), policy).then(() => {
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'hooks' }));
    expect(terminator).toHaveBeenCalled();
    expect(abortSpy).not.toHaveBeenCalled();
  });
});
```

Red → Green by implementing `PolicyDispatcher.dispatch` with explicit `case 'kill'` arm that schedules the telemetry beacon, awaits the grace period, then calls `terminator()`.

Refactor: pull each policy arm into its own `Strategy` class to keep `PolicyDispatcher` focused on routing.

---

### 3.4 Bounded Context: **Subscriber & Lifecycle** (supporting)

**Responsibility:** Track JS-side subscribers, refcount engine start/stop, gate event delivery on lifecycle state.

#### 3.4.1 Building blocks

| Building Block | Examples |
|---|---|
| **Aggregate Root** | `SubscriberRegistry` |
| **Entity** | `Subscriber` |
| **Value Object** | `SubscriberId`, `Filter`, `RefCount` |
| **Domain Event** | `SubscriberAttachedEvent`, `SubscriberDetachedEvent`, `EngineRefcountReachedZeroEvent` |
| **Port** | `EngineLifecyclePort` |

#### 3.4.2 Invariants

- I-16: Engine starts iff first subscriber attaches with `running == false`.
- I-17: Engine stops iff last subscriber detaches AND `stopOnUnmount: true`.
- I-18: `SubscriberId` is unique within a process.
- I-19: A `Filter` returning false for an event causes the dispatcher to skip *that subscriber only*.

#### 3.4.3 Worked TDD on I-16 + I-17

```ts
// __tests__/subscriberRegistry.spec.ts
test('engine starts on first attach, stops on last detach when stopOnUnmount=true', () => {
  const lifecycle = { start: jest.fn(), stop: jest.fn() };
  const registry = new SubscriberRegistry({ lifecycle, stopOnUnmount: true });

  registry.attach('s1', () => true);
  expect(lifecycle.start).toHaveBeenCalledTimes(1);

  registry.attach('s2', () => true);
  expect(lifecycle.start).toHaveBeenCalledTimes(1);    // not re-started

  registry.detach('s1');
  expect(lifecycle.stop).not.toHaveBeenCalled();

  registry.detach('s2');
  expect(lifecycle.stop).toHaveBeenCalledTimes(1);
});

test('does not stop when stopOnUnmount=false (default)', () => {
  const lifecycle = { start: jest.fn(), stop: jest.fn() };
  const registry = new SubscriberRegistry({ lifecycle });   // default false

  registry.attach('s1', () => true);
  registry.detach('s1');
  expect(lifecycle.stop).not.toHaveBeenCalled();
});
```

This test pair drives the refcount design and the `stopOnUnmount` opt-in.

---

### 3.5 Bounded Context: **Threat Telemetry — Client** (supporting)

**Responsibility:** Buffer, batch, and ship `ThreatEvent`s to configured adapters; survive offline; backpressure cleanly.

#### 3.5.1 Building blocks

| Building Block | Examples |
|---|---|
| **Aggregate Root** | `TelemetryDispatcher` |
| **Entity** | `OfflineBuffer` (SQLite-backed) |
| **Value Object** | `Batch`, `BackoffSchedule`, `RedactionPolicy` |
| **Domain Service** | `Redactor`, `BatchAssembler` |
| **Port** | `TelemetryAdapter` |

#### 3.5.2 Invariants

- I-20: Events are delivered **at-least-once** to the adapter (drops only when buffer cap is exceeded; drop count is itself a telemetry event).
- I-21: Redaction always runs before the adapter sees the payload.
- I-22: Backoff is bounded; never infinite retry without jitter.

#### 3.5.3 TDD example for I-20

```ts
test('events queue when adapter throws, drain on next success', async () => {
  const adapter = jest.fn()
    .mockRejectedValueOnce(new Error('net'))
    .mockRejectedValueOnce(new Error('net'))
    .mockResolvedValueOnce(undefined);
  const dispatcher = new TelemetryDispatcher({
    adapter, buffer: new InMemoryBuffer(), backoff: { initialMs: 1, maxMs: 4 },
  });

  await dispatcher.send(threatEvent('hooks'));
  // The two rejections cause backoff; the third call succeeds.
  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(3));
  expect(dispatcher.bufferSize).toBe(0);
});
```

---

### 3.6 Bounded Context: **Observability Ingest — Server** (supporting)

**Responsibility:** Authenticate, validate, redact, fan-out, account.

#### 3.6.1 Building blocks (Node service)

| Building Block | Examples |
|---|---|
| **Aggregate Root** | `IngestPipeline` |
| **Entity** | `Tenant`, `BatchReceipt` |
| **Value Object** | `EcsEvent`, `BatchId`, `RateLimit` |
| **Domain Service** | `EcsValidator`, `Redactor`, `FanOut` |
| **Port** | `Sink` (Logstash, S3, Kafka, Loki) |

#### 3.6.2 Invariants

- I-23: A required `Sink` failure → 5xx to client.
- I-24: A duplicate `(tenantId, batchId)` within 24h is acknowledged once and side-effects run once.
- I-25: Server-side redaction is idempotent: applying it twice equals applying it once.

#### 3.6.3 TDD on I-24 (idempotency)

Vitest + Testcontainers:

```ts
import { startContainers, stopContainers } from './harness';

beforeAll(startContainers);
afterAll(stopContainers);

test('duplicate batchId is acknowledged but not re-fanned-out', async () => {
  const batch  = ndjsonOf(threatEvent('hooks'));
  const id     = 'batch-uuid-1';
  const r1 = await collector.post('/v1/ingest', { headers: { 'X-Batch-Id': id }, body: batch });
  const r2 = await collector.post('/v1/ingest', { headers: { 'X-Batch-Id': id }, body: batch });
  expect(r1.status).toBe(202);
  expect(r2.status).toBe(202);

  const docs = await es.search({ index: 'logs-guardian.threat-*' });
  expect(docs.hits.total.value).toBe(1);
});
```

---

### 3.7 Bounded Context: **Reporting** (supporting)

**Responsibility:** Run scheduled queries against ES, render, deliver.

#### 3.7.1 Building blocks

- Aggregate Root: `Digest`.
- Entity: `Schedule`.
- Value Objects: `Query`, `RenderedReport`, `Recipient`.
- Domain Service: `Renderer`, `Deliverer`.
- Port: `EsQueryPort`, `EmailPort`.

#### 3.7.2 Invariants

- I-26: A digest is delivered at most once per (tenant, period). De-dup by `(tenantId, periodStart, periodEnd)`.
- I-27: A digest with empty data renders a clean "no events" body, not an error.

#### 3.7.3 TDD on I-27

```ts
test('empty week renders a "no events" digest, not an error', async () => {
  const empty = await reportingWorker.run({ tenantId: 't1', start: aWeekAgo, end: now });
  expect(empty.html).toContain('No threats detected this week');
  expect(empty.html).not.toContain('undefined');
});
```

---

### 3.8 Bounded Context: **Compatibility** (supporting, ACL)

**Responsibility:** Translate `freerasp-react-native` shapes (in) and behaviours (out).

#### 3.8.1 Building blocks

- Aggregate Root: `LegacyAdapter`.
- Domain Service: `ConfigTranslator`, `ActionRouter`.
- Anti-corruption barrier: nothing in this context leaks into other contexts.

#### 3.8.2 Invariants

- I-28: Behaviour for the freerasp-rn 4.5.x example app suite is identical when running against the shim.
- I-29: No legacy shape (`TalsecConfig`, `ThreatEventActions`) crosses into Threat Detection or Response & Policy.

#### 3.8.3 TDD on I-28

```ts
test('compat shim passes the freerasp-rn example test suite verbatim', async () => {
  const result = await runFreeraspExampleSuite({ shim: 'guardian-rn/compat/freerasp-rn' });
  expect(result.passed).toBe(result.total);
});
```

---

### 3.9 Bounded Context: **Configuration & Codegen** (generic)

**Responsibility:** Schemas → typed artefacts.

- Aggregate: `Schema`.
- Domain Service: `CodegenPipeline`.
- Invariants: I-30: regenerating produces no diff (idempotent). I-31: every schema change has a matching code-side change in the same PR.

#### 3.9.1 TDD on I-30

```bash
yarn codegen && git diff --exit-code
```

This is run as a CI step; the "test" is the script's exit code.

---

## 4. Cross-cutting Test Discipline

### 4.1 Outside-in TDD

We default to **outside-in**:

1. **Acceptance test** in Gherkin (`*.feature`) describes user-visible behaviour. It fails (red).
2. **Drive units** by writing the simplest tests for the next missing piece, in unit-test files, until the acceptance test goes green.
3. **Refactor** with green tests as a safety net.

This keeps tests honest: every unit test exists because an acceptance test demanded it.

### 4.2 Test taxonomy

Pragmatic mix:

- **London school (mockist)** for collaborator interactions across context boundaries (e.g., does the `PolicyDispatcher` *call* the `Terminator`?).
- **Chicago school (classicist)** for pure value objects and domain services (e.g., does `Conflation.merge(a, b)` produce the right result?).
- **Property-based (`fast-check`, `Kotest property`, `SwiftCheck`)** for invariants — *any* invariant. Especially crypto and value-object validation.
- **Fuzz tests (P7 hardening)** for the verifier and the canonical-JSON serialiser. 1M random mutations must reject 100%.
- **Approval / golden-file tests** for renderers (email HTML, PDF) and dashboards (Grafana JSON).
- **Contract tests** between contexts: the producer publishes a schema; the consumer asserts it parses.

### 4.3 Test pyramid (rough proportions)

```
                       E2E (Detox / Newman)
                       ─── 5%
                  Integration (RN-bridge sim, testcontainers)
                  ─── 15%
        Unit + property + fuzz
        ─── 80%
```

### 4.4 What NOT to test

- Generated code from codegen (test the generator, not the output).
- Third-party library behaviour (test our usage of it, not it).
- Trivial getters/setters (waste of test).
- Things that have not yet been required by any code path or feature (don't test future work).

### 4.5 Test naming convention

`<Subject>.<Aspect>.<Condition>.spec.ts` (or `.kt`, `.swift`).

Example: `EnvelopeVerifier.rejects.replay.spec.ts`. The aspect is the *invariant or behaviour*; the condition is the *trigger*. Files this small are easy to find, easy to delete, and rarely conflict.

### 4.6 A red flag the team watches for

> "I can't test this without mocking everything."

That's a design smell, not a test smell. The mocks are telling you a class has too many collaborators or wrong-shaped collaborators. **Refactor the design, not the test.**

---

## 5. Worked Mini-Walkthrough: Adding a New Threat (DDD + TDD in action)

Concrete end-to-end of "I want to detect *Audio recording while in foreground*". Time it: ~half a day.

1. **Update glossary** (`05-wiki/reference/Glossary.md`) — add `audioRecording` term, define the threat in the Threat Detection context.
2. **Update schema** (`schemas/threats.schema.json`) — add `audioRecording`, define its evidence shape (`{kind:'audioRecording', source:'mic'|'unknown'}`), severity and confidence baselines.
3. **Run codegen** (`yarn codegen`) — TS, Kotlin, Swift artefacts regenerate.
4. **Write the acceptance test** (`packages/engine-community/features/audioRecording.feature`) — fails (no detector).
5. **Write the unit test** for the new `AudioRecordingDetector.detect()` — fails (no class).
6. **Implement the detector** minimally — Android: query `AudioManager.getActiveRecordingConfigurations()`; iOS: check `AVAudioSession.sharedInstance().isOtherAudioPlaying` + recording permission state.
7. **Run unit tests** — green.
8. **Run acceptance test** — green.
9. **Refactor**: extract platform-specific code behind `AudioPort`; add property test for confidence boundaries.
10. **Update telemetry adapters** — none (the new event flows through the existing pipeline because schema-driven).
11. **Update Grafana dashboard** D-1 — add the new ThreatId to its `terms` filter inclusion list.
12. **Update threat catalogue page** in the wiki.
13. **Open PR** with all of the above in one commit per concern. Reviewer checks invariants, glossary, tests, dashboard.
14. **Merge** → release in next minor version.

The schema change touches *one* file. Codegen + tests do the rest. **No three-way coupling**, which was the explicit pain point we set out to remove.

---

## 6. Anti-Patterns We Refuse

- **God service**: a class named `ThreatService` doing detection + policy + telemetry. Split by context; that name doesn't exist here.
- **Anaemic domain model**: data classes with no behaviour, all logic in services. Our value objects encapsulate their invariants (see `ThreatPayload.of()`).
- **Smart-UI**: React components calling native APIs directly. UI consumes hooks; hooks consume the store; the store is the only client of the bridge.
- **Shared mutable state across contexts**: each context owns its model; communication is via domain events or explicit ports.
- **Test-after**: writing tests once code "works". The tests aren't tests then; they're regression nets at best, lies at worst.
- **Big-bang releases**: 50 changes lumped into a "v2.0". We release small, often, behind flags.

---

## 7. Summary

- Eight bounded contexts, three core, five supporting, one generic.
- Aggregates and value objects own their invariants; tests express those invariants first.
- Outside-in TDD with property-based reinforcement; fuzz at the boundaries.
- The Compatibility ACL is the only place legacy concepts live.
- Codegen is the shared kernel; the schema is the source of truth.
- The Ubiquitous Language is *the* glossary; tests, comments, and code use the exact words.
- A new threat takes one schema change, codegen, a detector, two tests, a dashboard tweak. Half a day, not a week.
