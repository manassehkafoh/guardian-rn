import type { ThreatId } from '@guardian/rn/src/generated/ThreatId.js';
import type { Severity } from '@guardian/rn/src/generated/Severity.js';

export interface DetectorResult {
  readonly detected: boolean;
  readonly confidence: number;
  readonly evidence: Readonly<Record<string, string>>;
}

export interface Detector {
  readonly threatId: ThreatId;
  readonly severity: Severity;
  run(): Promise<DetectorResult>;
}
