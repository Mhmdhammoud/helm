#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(HelmNative, NSObject)
RCT_EXTERN_METHOD(browse:(nonnull NSNumber *)timeoutMs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(load:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(save:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
