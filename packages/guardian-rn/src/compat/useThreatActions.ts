import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { ThreatId } from '../generated/ThreatId.js';

/**
 * Mirrors the freerasp-react-native TalsecConfig.listeners shape so that
 * teams migrating from freerasp-rn can drop this hook in without rewriting
 * their callback wiring. Maps the 22-threat surface to freerasp event names.
 *
 * Phase 6 adds full TalsecConfig → GuardianConfig bridging.
 * This file covers the listener/callback side only.
 */
export interface FreeRaspListeners {
  privilegedAccess?: () => void;
  debug?: () => void;
  simulator?: () => void;
  appIntegrity?: () => void;
  unofficialStore?: () => void;
  hooks?: () => void;
  deviceBinding?: () => void;
  deviceID?: () => void;
  passcode?: () => void;
  screenshot?: () => void;
  overlay?: () => void;
  tapjacking?: () => void;
  systemVPN?: () => void;
  devMode?: () => void;
  adbEnabled?: () => void;
  malware?: (packageInfo: { packageName: string; severity: string }) => void;
}

const FREERASP_MAP: Partial<Record<ThreatId, keyof FreeRaspListeners>> = {
  root: 'privilegedAccess',
  jailbreak: 'privilegedAccess',
  debugger: 'debug',
  simulator: 'simulator',
  repackaging: 'appIntegrity',
  tamper: 'appIntegrity',
  unofficialStore: 'unofficialStore',
  hooks: 'hooks',
  hardwareBackedKeysMissing: 'deviceBinding',
  passcodeMissing: 'passcode',
  screenCapture: 'screenshot',
  overlay: 'overlay',
  taskHijacking: 'tapjacking',
  systemVPN: 'systemVPN',
  devMode: 'devMode',
  adbEnabled: 'adbEnabled',
  malware: 'malware',
};

const FREERASP_ENTRIES = Object.entries(FREERASP_MAP) as Array<
  [ThreatId, keyof FreeRaspListeners]
>;

/**
 * Converts a freerasp-style listeners object into a GuardianActions-compatible map.
 * Use with GuardianConfig.actions for a drop-in migration path.
 */
export function fromFreeRaspListeners(
  listeners: FreeRaspListeners,
): Partial<Record<ThreatId, (event: ThreatEvent) => void>> {
  const actions: Partial<Record<ThreatId, (event: ThreatEvent) => void>> = {};

  for (const [threatId, listenerKey] of FREERASP_ENTRIES) {
    const cb = listeners[listenerKey];
    if (!cb) continue;

    actions[threatId] = (event: ThreatEvent) => {
      if (listenerKey === 'malware') {
        (cb as FreeRaspListeners['malware'])?.({
          packageName: event.evidence['packageName'] ?? 'unknown',
          severity: event.severity,
        });
      } else {
        (cb as () => void)();
      }
    };
  }

  return actions;
}
