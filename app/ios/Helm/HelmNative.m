#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(HelmNative, NSObject)
RCT_EXTERN_METHOD(browse:(nonnull NSNumber *)timeoutMs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(load:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(save:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end

#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(HelmSymbolViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(name, NSString)
RCT_EXPORT_VIEW_PROPERTY(size, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(weight, NSString)
RCT_EXPORT_VIEW_PROPERTY(color, UIColor)
RCT_EXPORT_VIEW_PROPERTY(bounce, NSNumber)
@end
