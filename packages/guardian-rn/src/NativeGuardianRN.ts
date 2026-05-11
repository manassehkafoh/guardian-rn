import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * TurboModule spec for guardian-rn.
 * React Native codegen reads this file to generate the C++ bridge boilerplate.
 * Per ADR-0001: no legacy bridge; no NativeModules fallback.
 */
export interface Spec extends TurboModule {
  /**
   * Start the native engine with the given JSON-serialised config.
   * Resolves with the sessionId once the engine is initialised.
   */
  start(configJson: string): Promise<string>;

  /** Stop the engine and flush in-flight events. */
  stop(): Promise<void>;

  /**
   * Deliver the 32-byte HMAC session key to JS as a base64 string.
   * May only be called once per process lifetime (ADR-0003).
   * Subsequent calls reject with GUARDIAN_KEY_ALREADY_DELIVERED.
   */
  getSessionKey(): Promise<string>;

  /**
   * Install the JSI HostObject into the JS runtime.
   * Called internally by start(); exposed here so the TurboModule spec
   * includes the binding — actual JSI install happens on the native side.
   */
  installJSIBindings(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('GuardianRN');
