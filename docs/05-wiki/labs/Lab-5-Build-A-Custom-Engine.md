---
title: "Lab 5 – Build a Custom Engine"
type: tutorial
audience: sdk-engineer
duration: 120 min
prerequisites: Lab 1 complete; Lab 2 complete; Kotlin basics; Swift basics
last_reviewed: 2026-05-10
---

# Lab 5 – Build a Custom Engine

> **Goal:** implement the `Engine` interface in both Kotlin and Swift to create a minimal custom detector — one that fires a `timeSpoofing` event when the device clock is skewed by more than 60 seconds — and register it alongside the community engine in the example app.

This lab teaches the extension point that lets any team (or vendor) plug a proprietary detector into `guardian-rn` without touching the core TurboModule. After this lab you will understand exactly what a commercial engine adapter (e.g., `@guardian/engine-talsec`) does internally.

---

## Before you start

- Lab 2 must be complete so the `timeSpoofing` threat type exists in the schema and generated code.
- You will write tests before production code in each step (London-school TDD: mock collaborators, test the engine in isolation).

---

## Step 1 — Understand the Engine contract

Read the contract before writing code:

```typescript
// packages/guardian-rn/src/engine/Engine.ts  (generated reference)
export interface Engine {
  readonly id: string;      // e.g., "time-spoof-detector@1.0.0"
  start(context: EngineContext): Promise<void>;
  stop(): Promise<void>;
  readonly onThreat: Observable<ThreatEvent>;
  readonly onHealthTick: Observable<EngineHealthTick>;
}
```

Key invariants (from `06-domain-driven-design-with-tdd.md`, §Engine bounded context):

1. `start()` must resolve before any event is emitted.
2. `stop()` must be idempotent — safe to call twice.
3. Events emitted after `stop()` resolves are silently dropped by the bus.
4. `onHealthTick` must emit at least once per 60 s while running; absence triggers alert A-2.

---

## Step 2 — Write the Kotlin engine test (red)

Create `packages/engine-time-spoof/android/src/test/kotlin/TimeSpooferEngineTest.kt`:

```kotlin
import com.guardian.rn.engine.*
import com.guardian.rn.generated.ThreatEvent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class TimeSpooferEngineTest {

    @Test
    fun `emits timeSpoofing when clock skew exceeds threshold`() = runTest {
        val fakeTime = FakeTimeSource(networkMs = 1_000_000L, deviceMs = 1_061_000L) // +61s skew
        val engine = TimeSpooferEngine(timeSource = fakeTime, thresholdMs = 60_000L)
        engine.start(fakeEngineContext())

        val event = engine.onThreat.first()
        assertIs<ThreatEvent.TimeSpoofing>(event)
        assertEquals(61_000L, (event.evidence["skewMs"] as Long))

        engine.stop()
    }

    @Test
    fun `does not emit when skew is within threshold`() = runTest {
        val fakeTime = FakeTimeSource(networkMs = 1_000_000L, deviceMs = 1_030_000L) // +30s skew
        val engine = TimeSpooferEngine(timeSource = fakeTime, thresholdMs = 60_000L)
        engine.start(fakeEngineContext())

        // No event should be emitted; first() would suspend forever — use timeout
        val result = withTimeoutOrNull(500L) { engine.onThreat.first() }
        assertEquals(null, result)

        engine.stop()
    }
}
```

Run the test — it fails because `TimeSpooferEngine` does not exist yet:

```bash
./gradlew :engine-time-spoof:testDebugUnitTest
```

Expected: `BUILD FAILED — unresolved reference: TimeSpooferEngine`

---

## Step 3 — Implement the Kotlin engine (green)

Create `packages/engine-time-spoof/android/src/main/kotlin/TimeSpooferEngine.kt`:

```kotlin
class TimeSpooferEngine(
    private val timeSource: TimeSource,
    private val thresholdMs: Long = 60_000L,
    private val pollIntervalMs: Long = 30_000L,
) : Engine {

    override val id = "time-spoof-detector@1.0.0"

    private val _onThreat = MutableSharedFlow<ThreatEvent>(replay = 0)
    override val onThreat: Flow<ThreatEvent> = _onThreat

    private val _onHealthTick = MutableSharedFlow<EngineHealthTick>(replay = 0)
    override val onHealthTick: Flow<EngineHealthTick> = _onHealthTick

    private var job: Job? = null

    override suspend fun start(context: EngineContext) {
        job = CoroutineScope(Dispatchers.IO).launch {
            while (isActive) {
                val skewMs = abs(timeSource.networkMs() - timeSource.deviceMs())
                if (skewMs > thresholdMs) {
                    _onThreat.emit(
                        ThreatEvent.TimeSpoofing(evidence = mapOf("skewMs" to skewMs))
                    )
                }
                _onHealthTick.emit(EngineHealthTick(engineId = id, ts = System.currentTimeMillis()))
                delay(pollIntervalMs)
            }
        }
    }

    override suspend fun stop() {
        job?.cancelAndJoin()
        job = null
    }
}
```

Re-run the tests:

```bash
./gradlew :engine-time-spoof:testDebugUnitTest
```

Expected:

```
BUILD SUCCESSFUL
2 tests completed, 0 failed
```

---

## Step 4 — Write and implement the Swift engine

Create the test first (`TimeSpooferEngineTests.swift`):

```swift
import XCTest
import Combine
@testable import EngineTimeSpoof

final class TimeSpooferEngineTests: XCTestCase {

    func test_emitsTimeSpoofing_whenSkewExceedsThreshold() async throws {
        let fake = FakeTimeSource(networkMs: 1_000_000, deviceMs: 1_061_000)
        let engine = TimeSpooferEngine(timeSource: fake, thresholdMs: 60_000)
        try await engine.start(context: .mock)

        var events: [ThreatEvent] = []
        let cancellable = engine.onThreat.sink { events.append($0) }
        try await Task.sleep(nanoseconds: 100_000_000)
        cancellable.cancel()
        await engine.stop()

        XCTAssertEqual(events.count, 1)
        if case .timeSpoofing(let evidence) = events[0] {
            XCTAssertEqual(evidence["skewMs"] as? Int64, 61_000)
        } else {
            XCTFail("Wrong event type")
        }
    }
}
```

Then implement `TimeSpooferEngine.swift`:

```swift
public final class TimeSpooferEngine: Engine {
    public let id = "time-spoof-detector@1.0.0"

    private let timeSource: TimeSource
    private let thresholdMs: Int64
    private let pollIntervalNs: UInt64
    private var task: Task<Void, Never>?

    private let threatSubject = PassthroughSubject<ThreatEvent, Never>()
    private let healthSubject = PassthroughSubject<EngineHealthTick, Never>()

    public var onThreat: AnyPublisher<ThreatEvent, Never> { threatSubject.eraseToAnyPublisher() }
    public var onHealthTick: AnyPublisher<EngineHealthTick, Never> { healthSubject.eraseToAnyPublisher() }

    public init(timeSource: TimeSource = NTPTimeSource(), thresholdMs: Int64 = 60_000, pollIntervalMs: Int64 = 30_000) {
        self.timeSource = timeSource
        self.thresholdMs = thresholdMs
        self.pollIntervalNs = UInt64(pollIntervalMs) * 1_000_000
    }

    public func start(context: EngineContext) async throws {
        task = Task {
            while !Task.isCancelled {
                let skew = abs(timeSource.networkMs() - timeSource.deviceMs())
                if skew > thresholdMs {
                    threatSubject.send(.timeSpoofing(evidence: ["skewMs": skew]))
                }
                healthSubject.send(EngineHealthTick(engineId: id, ts: Int64(Date().timeIntervalSince1970 * 1000)))
                try? await Task.sleep(nanoseconds: pollIntervalNs)
            }
        }
    }

    public func stop() async {
        task?.cancel()
        task = nil
    }
}
```

Run iOS tests:

```bash
xcodebuild test \
  -workspace apps/example/ios/GuardianExample.xcworkspace \
  -scheme EngineTimeSpoof-Tests \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

Expected: `2 tests passed, 0 failed`

---

## Step 5 — Register the custom engine in the example app

Open `apps/example/src/App.tsx`. Import and configure both engines:

```typescript
import { communityEngine } from '@guardian/engine-community';
import { TimeSpooferEngine } from '@guardian/engine-time-spoof';

const guardian = useGuardian({
  engines: [
    communityEngine(),
    new TimeSpooferEngine({ thresholdMs: 60_000 }),
  ],
  telemetry,
  actions: {
    timeSpoofing: () => addThreat({ id: 'timeSpoofing', severity: 'medium', ts: Date.now() }),
    // ...other handlers
  },
});
```

Note the change from `engine` (singular) to `engines` (array) — the bus merges all engine streams behind the same HMAC pipeline.

---

## Step 6 — Verify in the running app

Start the app (Metro + simulator). In the Metro console:

```
[guardian] engine started — community@1.0.0
[guardian] engine started — time-spoof-detector@1.0.0
[guardian] AllChecksFinished — 0 threats detected
```

Both engines appear in the health tick. To trigger the time-spoof detector manually, use the simulator's date-override feature:

- **iOS:** Settings → General → Date & Time → turn off "Set Automatically" → set the clock +90 minutes.
- **Android:** Extended Controls → Date and Time → advance 90 minutes.

Within the next poll interval (≤ 30 s) you should see:

```
[guardian] threat: timeSpoofing — { skewMs: 5400000 }
```

Restore the clock afterward.

---

## Step 7 — Confirm dual-engine health ticks in Grafana

With the collector running (Lab 4), open **D-2 Engine Health** in Grafana. You should see two heartbeat rows: `community@1.0.0` and `time-spoof-detector@1.0.0`. If either goes silent for 60 s, alert A-2 fires.

---

## You should now understand

- The `Engine` interface is the only contract between `guardian-rn` and any detector implementation. Engines do not know about the HMAC pipeline, the JS bridge, or the telemetry adapter.
- The bus merges multiple engine streams: `useGuardian` accepts an `engines` array and all events go through the same HMAC envelope and telemetry path.
- Health ticks are mandatory: engines that do not emit `onHealthTick` at least once per 60 s trigger operational alert A-2.
- London-school TDD (inject `FakeTimeSource`) lets you test engine logic without real network calls or clock manipulation.
- The same engine package works on both platforms because the `Engine` interface maps identically to both the Kotlin and Swift equivalents — codegen ensures this.

---

**Next lab:** [Lab 6 – Trigger and Triage a False Positive](Lab-6-Trigger-And-Triage-A-False-Positive.md) — learn how to identify, confirm, and tune a false positive without shipping a new SDK version.
