import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { ResponsePolicy } from '../generated/ResponsePolicy.js';
import type { ThreatId } from '../generated/ThreatId.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { SignPayload } from '../telemetry/TelemetryAdapter.js';
import { OODAController } from './ooda.js';

// ─────────────────────────────────────────────────────────────────────────────
// Default policy map
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baseline threat-to-policy assignments.
 *
 * These reflect the threat model for a typical consumer financial or
 * enterprise mobile app. Tenants override them via GuardianConfig.policies.
 *
 * Policy meanings (ResponsePolicy):
 *   'telemetry' — log the event; no user-visible action. Use for low-signal
 *                 or highly environment-specific detections (emulator, systemVPN).
 *   'restrict'  — degrade non-critical features (disable high-value transfers,
 *                 hide sensitive data). Reversible; user can continue session.
 *   'lockout'   — block the current session, require re-authentication.
 *                 The most disruptive recoverable action.
 *   'kill'      — terminate the process after the grace period.
 *                 Reserved for detections where the app's security guarantees
 *                 are fundamentally broken and continuation is dangerous.
 *
 * Rationale for notable assignments:
 *   hooks → kill   : A running hook framework (Frida, Xposed) means every
 *                    in-app check can be intercepted and forged. There is no
 *                    recovery path; continuing the session risks credential theft.
 *   tamper → kill  : Code tampering means the binary executing is not the one
 *                    the developer signed. The app's integrity cannot be assumed.
 *   repackaging → kill : Same reasoning — the entire trust chain is broken.
 *   jailbreak/root → lockout (not kill): These detections have a meaningful
 *                    false-positive rate on custom ROMs and developer devices.
 *                    Lockout is proportionate; escalate to kill via config if
 *                    your threat model requires it.
 *   emulator → telemetry: Emulators are routinely used by developers and QA.
 *                    Log for anomaly detection; do not block in production unless
 *                    you have confirmed your legitimate user population never
 *                    runs your app in an emulator.
 */
export const DEFAULT_POLICIES: Partial<Record<ThreatId, ResponsePolicy>> = {
  root:                    'lockout',
  jailbreak:               'lockout',
  debugger:                'restrict',
  hooks:                   'kill',
  tamper:                  'kill',
  emulator:                'telemetry',
  malware:                 'lockout',
  screenCapture:           'restrict',
  timeSpoofing:            'restrict',
  privilegedAccess:        'lockout',
  simulator:               'telemetry',
  unofficialStore:         'restrict',
  overlay:                 'restrict',
  taskHijacking:           'lockout',
  repackaging:             'kill',
  systemVPN:               'telemetry',
  devMode:                 'telemetry',
  adbEnabled:              'telemetry',
  passcodeMissing:         'restrict',
  biometricMissing:        'telemetry',
  hardwareBackedKeysMissing: 'restrict',
  engineFault:             'telemetry',
  sessionExpiry:           'lockout',
  behavioralAnomaly:       'restrict',
};

// ─────────────────────────────────────────────────────────────────────────────
// Default confidence thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static default thresholds before any OODA adaptive tightening.
 *
 * Exported as a const tuple so the OODAController can reference them
 * as its base without importing from a circular dependency path.
 *
 *   0.5 restrict — moderate confidence: multiple independent signals agree.
 *   0.7 lockout  — high confidence: strong evidence from several methods.
 *   0.9 kill     — near-certain: all available signals converge.
 */
export const DEFAULT_CONFIDENCE_THRESHOLDS = {
  restrict: 0.5,
  lockout:  0.7,
  kill:     0.9,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PolicyEngine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies the threat-to-policy mapping and invokes the appropriate host app
 * callback for each incoming ThreatEvent.
 *
 * ── Lifecycle ─────────────────────────────────────────────────────────────
 *
 * One PolicyEngine is created per useGuardian mount and destroyed on unmount.
 * It is not shared between sessions — each mount gets fresh kill timers,
 * a fresh OODA controller (if configured), and fresh signPayload closure.
 *
 * ── Decision flow for a single event ─────────────────────────────────────
 *
 *   1. Resolve effective policy: config.policies[id] ?? DEFAULT_POLICIES[id] ?? 'telemetry'
 *   2. Record the event with OODAController.observe() to get adaptive thresholds.
 *   3. Forward event to telemetry adapter (unconditionally, regardless of policy).
 *   4. If policy is 'telemetry': done.
 *   5. If policy is 'restrict' and confidence ≥ restrict threshold: call onRestrict.
 *   6. If policy is 'lockout'  and confidence ≥ lockout threshold:  call onLockout.
 *   7. If policy is 'kill'     and confidence ≥ kill threshold:     schedule kill.
 *
 * Note: the flow is early-return. An event matching 'restrict' will NOT also
 * check 'lockout'. The policy resolution picks one tier; the thresholds gate
 * whether that tier's action fires. This is intentional — a single event does
 * not cascade through all tiers.
 *
 * ── Kill timer deduplication ──────────────────────────────────────────────
 *
 * Only one kill timer is allowed per threatId at any time. If a second kill-
 * level event for the same threatId arrives before the first timer fires, it
 * is silently ignored. This prevents a storm of kill events from stacking up
 * multiple termination calls after the grace period.
 */
export class PolicyEngine {
  private readonly config: GuardianConfig;

  /**
   * Closure over the per-session HMAC key. Passed to TelemetryAdapter so
   * adapters can sign outbound payloads without ever holding the raw key.
   * Per ADR-0014: the key never leaves the PolicyEngine boundary.
   */
  private readonly signPayload: SignPayload;

  /**
   * OODA adaptive threshold controller. Null when config.adaptiveThresholds
   * is not set, which preserves v1.0.x static-threshold behaviour.
   */
  private readonly ooda: OODAController | null;

  /**
   * Active kill timers keyed by threatId. Needed for:
   *   1. Deduplication — prevents duplicate timers for the same threat.
   *   2. Cancellation — cancelPendingKills() clears all timers on unmount
   *      so the terminator never fires after the component is gone.
   */
  private killTimers = new Map<ThreatId, ReturnType<typeof setTimeout>>();

  constructor(config: GuardianConfig, signPayload: SignPayload) {
    this.config = config;
    this.signPayload = signPayload;

    // Construct the OODA controller only when adaptive thresholds are
    // configured. Passing config.confidenceThresholds as the base gives
    // the controller the same starting point as the static-threshold path,
    // so OODA escalation is always relative to the tenant's custom thresholds.
    this.ooda = config.adaptiveThresholds
      ? new OODAController(config.adaptiveThresholds, config.confidenceThresholds)
      : null;
  }

  /**
   * Process one ThreatEvent through the full policy pipeline.
   *
   * This method is called on the JS thread for every event emitted by any
   * engine. It must be fast — no awaits, no I/O. Telemetry adapters that
   * need async operations (HTTP, disk) should buffer internally and flush
   * on a separate timer.
   */
  apply(event: ThreatEvent): void {
    const policy = this.resolvePolicy(event.threatId);

    // OODA observe: records the event in the rolling window and returns
    // the effective thresholds (possibly tightened if we are escalated).
    // When OODA is disabled we fall back to a plain merge of defaults + config.
    const thresholds = this.ooda
      ? this.ooda.observe(event.ts)
      : { ...DEFAULT_CONFIDENCE_THRESHOLDS, ...this.config.confidenceThresholds };

    // Forward to telemetry unconditionally — the backend needs to see every
    // event, including those that do not trigger a policy action, to build
    // an accurate picture of what the device is observing.
    this.config.telemetry?.recordThreat(event, this.signPayload);

    // Telemetry-only: log but take no action.
    if (policy === 'telemetry') return;

    // Restrict: degrade features. Returns early — does not fall through to lockout.
    if (policy === 'restrict' && event.confidence >= thresholds.restrict) {
      this.config.actions.onRestrict?.(event);
      return;
    }

    // Lockout: block the session.
    if (policy === 'lockout' && event.confidence >= thresholds.lockout) {
      this.config.actions.onLockout?.(event);
      return;
    }

    // Kill: schedule process termination after grace period.
    if (policy === 'kill' && event.confidence >= thresholds.kill) {
      this.applyKill(event);
    }
  }

  /**
   * Cancel all pending kill timers. Called on component unmount so that
   * a kill event received during teardown does not terminate a process
   * that is already being legitimately closed.
   *
   * Also useful in tests to prevent timer leaks.
   */
  cancelPendingKills(): void {
    for (const timer of this.killTimers.values()) clearTimeout(timer);
    this.killTimers.clear();
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Policy resolution order (highest precedence first):
   *   1. Tenant config override: config.policies[threatId]
   *   2. SDK default:            DEFAULT_POLICIES[threatId]
   *   3. Safe fallback:          'telemetry'
   *
   * The safe fallback ensures unknown or future threatIds are never silently
   * ignored — they are at least logged to telemetry, where they will appear
   * as anomalies that trigger investigation.
   */
  private resolvePolicy(threatId: ThreatId): ResponsePolicy {
    return this.config.policies?.[threatId]
      ?? DEFAULT_POLICIES[threatId]
      ?? 'telemetry';
  }

  /**
   * Invoke the kill callback and schedule the terminator.
   *
   * The warning callback runs synchronously on the JS thread so the host
   * app can display a "session terminated" screen before the process ends.
   * The actual termination is deferred by graceMs to give the app time to:
   *   – Flush pending telemetry (analytics, crash reporters).
   *   – Show a user-facing error message.
   *   – Complete any in-flight writes to encrypted storage.
   *
   * Only one timer per threatId: if the same threat fires again within the
   * grace period, the second event is ignored. This prevents the grace
   * period from being reset by a burst of identical kill-level events.
   */
  private applyKill(event: ThreatEvent): void {
    const killPolicy = this.config.killPolicy;

    // Always invoke onKill immediately — the host app should react to the
    // kill decision even if the terminator is not configured.
    this.config.actions.onKill?.(event);

    // If the kill policy is not enabled, the SDK treats 'kill' policy as
    // effectively equivalent to 'lockout' — onKill fires but no timer runs.
    if (!killPolicy?.enabled) return;

    // Warn callback gives the host app synchronous notification before the
    // grace timer starts. Use this to update UI state if needed.
    killPolicy.warningCallback?.(event.threatId);

    // Dedup: if a timer is already running for this threatId, do not create
    // a second one. This is intentional — see class-level docstring.
    if (this.killTimers.has(event.threatId)) return;

    const timer = setTimeout(() => {
      this.killTimers.delete(event.threatId);
      this.config.terminator?.terminate({ threatId: event.threatId, ts: Date.now() });
    }, killPolicy.graceMs);

    this.killTimers.set(event.threatId, timer);
  }
}
