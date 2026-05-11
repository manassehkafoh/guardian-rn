import { useEffect, useRef } from 'react';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { EngineContext, Engine, EngineHealthTick } from '../engine/Engine.js';
import { PolicyEngine } from '../core/policy.js';
import { computeHmac } from '../core/HmacEnvelope.js';
import { canonicalJson } from '../core/CanonicalJson.js';

/**
 * Primary React hook. Starts all configured engines on mount,
 * wires the PolicyEngine to every threat event, and stops engines on unmount.
 *
 * Uses configRef to prevent stale-closure bugs — the most recent config is
 * always used at call-time, avoiding the freerasp-rn listener update issue.
 */
export function useGuardian(config: GuardianConfig): void {
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const sessionId = generateSessionId();
    const sessionKey = generateSessionKey();
    const subscriptions: Array<{ unsubscribe(): void }> = [];
    let policyEngine: PolicyEngine | null = null;
    let sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null;

    // Closure that signs arbitrary payloads using the session key.
    // Telemetry adapters receive this; they never hold the raw key.
    const signPayload = (data: string): string =>
      computeHmac(data, sessionKey);

    const ctx: EngineContext = {
      config: configRef.current,
      sessionId,
      platform: getPlatform(),
      managedProfile: false,
      onFault(error: Error) {
        console.error('[guardian] engine fault:', error);
      },
    };

    const startAll = async (): Promise<void> => {
      policyEngine = new PolicyEngine(configRef.current, signPayload);

      // Session expiry timer
      const maxAge = configRef.current.sessionMaxAgeMs;
      if (maxAge != null && maxAge > 0) {
        sessionExpiryTimer = setTimeout(() => {
          const expiryEvent: ThreatEvent = {
            threatId: 'sessionExpiry',
            severity: 'high',
            confidence: 1.0,
            evidence: { sessionId, maxAgeMs: String(maxAge) },
            ts: Date.now(),
            engineId: 'guardian-rn/session',
          };
          policyEngine?.apply(expiryEvent);
        }, maxAge);
      }

      for (const engine of configRef.current.engines) {
        try {
          await engine.start(ctx);

          const threatSub = engine.onThreat.subscribe({
            next: (event: ThreatEvent) => policyEngine!.apply(event),
          });
          subscriptions.push(threatSub);

          const healthSub = engine.onHealthTick.subscribe({
            next: (tick: EngineHealthTick) => configRef.current.telemetry?.recordHealthTick(tick),
          });
          subscriptions.push(healthSub);
        } catch (err) {
          ctx.onFault(err instanceof Error ? err : new Error(String(err)));
        }
      }

      // Battery-aware throttle: forward AppState changes to engines that opt in
      wireAppStateThrottle(configRef.current.engines);
    };

    void startAll();

    return () => {
      if (sessionExpiryTimer !== null) clearTimeout(sessionExpiryTimer);
      policyEngine?.cancelPendingKills();
      for (const sub of subscriptions) sub.unsubscribe();
      for (const engine of configRef.current.engines) void engine.stop();
    };
  // eslint-disable-next-line -- engines array identity is intentionally stable
  }, []);
}

function wireAppStateThrottle(engines: readonly Engine[]): (() => void) | undefined {
  try {
    const { AppState } = require('react-native') as {
      AppState: { addEventListener(event: string, cb: (state: string) => void): { remove(): void } };
    };
    const sub = AppState.addEventListener('change', (state: string) => {
      const mode = state === 'active' ? 'foreground' : 'background';
      for (const engine of engines) engine.throttle?.(mode);
    });
    return () => sub.remove();
  } catch {
    return undefined;
  }
}

function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 32-byte random session key. On real devices backed by platform secure RNG. */
function generateSessionKey(): Uint8Array {
  try {
    const { NativeModules } = require('react-native') as {
      NativeModules: { GuardianKeyProvider?: { generateSessionKey(): number[] } };
    };
    const raw = NativeModules.GuardianKeyProvider?.generateSessionKey();
    if (raw && raw.length === 32) return new Uint8Array(raw);
  } catch { /* fall through */ }
  // Fallback for tests and environments without the native module
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = (Math.random() * 256) | 0;
  return key;
}

function getPlatform(): 'android' | 'ios' {
  try {
    const { Platform } = require('react-native') as { Platform: { OS: string } };
    return Platform.OS === 'android' ? 'android' : 'ios';
  } catch {
    return 'ios';
  }
}
