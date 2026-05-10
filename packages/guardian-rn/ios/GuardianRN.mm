#import <React/RCTBridgeModule.h>

// TurboModule ObjC++ bridge.
// Per ADR-0001: no RCT_EXPORT_MODULE legacy bridge; codegen-generated spec only.
// Swift implementation in Sources/GuardianRN/GuardianRNModule.swift.
@interface RCT_EXTERN_MODULE(GuardianRN, NSObject)

RCT_EXTERN_METHOD(start:(NSDictionary *)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getSessionKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
