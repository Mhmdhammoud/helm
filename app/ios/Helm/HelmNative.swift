import Foundation
import UIKit

/// Bonjour discovery of Helm bridges, plus a tiny persistent store for paired Macs.
@objc(HelmNative)
class HelmNative: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  private var browser: NetServiceBrowser?
  private var pending: [NetService] = []
  private var found: [String: [String: Any]] = [:]

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func constantsToExport() -> [AnyHashable: Any] { ["deviceName": UIDevice.current.name] }

  /// Browses `_helm._tcp` for `timeoutMs`, resolving each service to host + port.
  @objc func browse(_ timeoutMs: NSNumber, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      self.browser?.stop()
      self.pending = []
      self.found = [:]
      let b = NetServiceBrowser()
      b.delegate = self
      b.searchForServices(ofType: "_helm._tcp.", inDomain: "local.")
      self.browser = b
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs.intValue)) {
        b.stop()
        resolve(Array(self.found.values))
      }
    }
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    pending.append(service)
    service.delegate = self
    service.resolve(withTimeout: 3)
  }

  func netServiceDidResolveAddress(_ sender: NetService) {
    guard let host = sender.hostName else { return }
    found[sender.name] = ["name": sender.name, "host": host.hasSuffix(".") ? String(host.dropLast()) : host, "port": sender.port]
  }

  // ponytail: UserDefaults, not Keychain; the tokens only unlock a LAN bridge. Move to Keychain if that changes.
  @objc func load(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(UserDefaults.standard.string(forKey: "helm.store"))
  }

  @objc func save(_ json: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    UserDefaults.standard.set(json, forKey: "helm.store")
    resolve(nil)
  }
}
