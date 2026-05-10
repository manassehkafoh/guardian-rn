import { useEffect, useRef } from 'react';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';

/**
 * Primary React hook. Starts all configured engines on mount,
 * subscribes to the merged threat stream, and applies response policies.
 * Stops all engines on unmount.
 *
 * Uses useRef for the latest config to avoid the stale-closure bug
 * present in freerasp-rn's useFreeRasp implementation.
 */
export function useGuardian(config: GuardianConfig): void {
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const sessionId = generateSessionId();
    const subscriptions: Array<{ unsubscribe(): void }> = [];

    const ctx = {
      config: configRef.current,
      sessionId,
      platform: getPlatform(),
      onFault(error: Error) {
        console.error('[guardian] engine fault:', error);
      },
    };

    const startAll = async (): Promise<void> => {
      for (const engine of configRef.current.engines) {
        try {
          await engine.start(ctx);

          const sub = engine.onThreat.subscribe({
            next: (event: ThreatEvent) => handleThreat(event, configRef.current),
          });
          subscriptions.push(sub);
        } catch (err) {
          ctx.onFault(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    void startAll();

    return () => {
      for (const sub of subscriptions) {
        sub.unsubscribe();
      }
      for (const engine of configRef.current.engines) {
        void engine.stop();
      }
    };
  }, []);
}

function handleThreat(event: ThreatEvent, config: GuardianConfig): void {
  const handler = config.actions[event.threatId];
  if (handler) {
    handler(event);
  }

  config.telemetry?.recordThreat(event);
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
