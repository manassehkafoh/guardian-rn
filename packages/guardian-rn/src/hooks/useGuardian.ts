import { useEffect, useRef } from 'react';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { EngineContext } from '../engine/Engine.js';
import { PolicyEngine } from '../core/policy.js';

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
    const subscriptions: Array<{ unsubscribe(): void }> = [];
    let policyEngine: PolicyEngine | null = null;

    const ctx: EngineContext = {
      config: configRef.current,
      sessionId,
      platform: getPlatform(),
      onFault(error: Error) {
        console.error('[guardian] engine fault:', error);
      },
    };

    const startAll = async (): Promise<void> => {
      policyEngine = new PolicyEngine(configRef.current);

      for (const engine of configRef.current.engines) {
        try {
          await engine.start(ctx);

          const threatSub = engine.onThreat.subscribe({
            next: (event: ThreatEvent) => policyEngine!.apply(event),
          });
          subscriptions.push(threatSub);

          const healthSub = engine.onHealthTick.subscribe({
            next: (tick) => configRef.current.telemetry?.recordHealthTick(tick),
          });
          subscriptions.push(healthSub);
        } catch (err) {
          ctx.onFault(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    void startAll();

    return () => {
      policyEngine?.cancelPendingKills();
      for (const sub of subscriptions) sub.unsubscribe();
      for (const engine of configRef.current.engines) void engine.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getPlatform(): 'android' | 'ios' {
  try {
    const { Platform } = require('react-native') as { Platform: { OS: string } };
    return Platform.OS === 'android' ? 'android' : 'ios';
  } catch {
    return 'ios';
  }
}
