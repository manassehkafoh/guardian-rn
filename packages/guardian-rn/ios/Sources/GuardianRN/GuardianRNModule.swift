import Foundation

/// TurboModule entry point for guardian-rn on iOS.
/// Lifecycle: start() → events via onThreat publisher → stop().
/// Per ADR-0001: no RCTEventEmitter legacy bridge.
@objc(GuardianRN)
class GuardianRNModule: NSObject {

    @objc
    func start(_ config: NSDictionary,
               resolve: @escaping RCTPromiseResolveBlock,
               reject: @escaping RCTPromiseRejectBlock) {
        // TODO(GUARD-1234) Phase 2: initialise engine, session key, HMAC envelope
        resolve(nil)
    }

    @objc
    func stop(_ resolve: @escaping RCTPromiseResolveBlock,
              reject: @escaping RCTPromiseRejectBlock) {
        // TODO(GUARD-1234) Phase 2: stop engine, flush telemetry
        resolve(nil)
    }
}
