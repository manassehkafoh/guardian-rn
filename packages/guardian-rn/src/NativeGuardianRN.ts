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
   * Install the JSI HostObject into the JS runtime.
   * Called internally by start(); exposed here so the TurboModule spec
   * includes the binding — actual JSI install happens on the native side.
   */
  installJSIBindings(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('GuardianRN');
