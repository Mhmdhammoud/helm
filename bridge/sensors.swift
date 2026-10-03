// `sensors`: prints the Mac's chip temperature and fans as JSON, for the bridge's thermal widget. No root needed:
// temperatures come from the IOHID event system, fans from reading (never writing) the SMC.
//   {"cpu": 74.5, "fans": [{"rpm": 1673, "min": 1000, "max": 4900}]}
import Foundation
import IOKit

@_silgen_name("IOHIDEventSystemClientCreate") func IOHIDEventSystemClientCreate(_ a: CFAllocator?) -> Unmanaged<AnyObject>?
@_silgen_name("IOHIDEventSystemClientSetMatching") func IOHIDEventSystemClientSetMatching(_ c: AnyObject, _ m: CFDictionary) -> Int32
@_silgen_name("IOHIDEventSystemClientCopyServices") func IOHIDEventSystemClientCopyServices(_ c: AnyObject) -> Unmanaged<CFArray>?
@_silgen_name("IOHIDServiceClientCopyProperty") func IOHIDServiceClientCopyProperty(_ s: AnyObject, _ k: CFString) -> Unmanaged<AnyObject>?
@_silgen_name("IOHIDServiceClientCopyEvent") func IOHIDServiceClientCopyEvent(_ s: AnyObject, _ t: Int64, _ a: Int32, _ b: Int64) -> Unmanaged<AnyObject>?
@_silgen_name("IOHIDEventGetFloatValue") func IOHIDEventGetFloatValue(_ e: AnyObject, _ f: Int32) -> Double

/// Hottest die sensor ("PMU tdie…" on Apple silicon, the CPU cores); nil where there are none.
func chipTemp() -> Double? {
  guard let client = IOHIDEventSystemClientCreate(kCFAllocatorDefault)?.takeRetainedValue() else { return nil }
  _ = IOHIDEventSystemClientSetMatching(client, ["PrimaryUsagePage": 0xff00, "PrimaryUsage": 5] as CFDictionary)
  var hottest: Double?
  for s in IOHIDEventSystemClientCopyServices(client)?.takeRetainedValue() as? [AnyObject] ?? [] {
    let name = IOHIDServiceClientCopyProperty(s, "Product" as CFString)?.takeRetainedValue() as? String ?? ""
    guard name.contains("tdie"), let e = IOHIDServiceClientCopyEvent(s, 15, 0, 0)?.takeRetainedValue() else { continue }
    let t = IOHIDEventGetFloatValue(e, 15 << 16)
    if t > 0 && t < 150 { hottest = max(hottest ?? t, t) } // some sensors report nonsense like -9201
  }
  return hottest
}

// Minimal AppleSMC reader. The layout must match the kernel's 80-byte SMCKeyData_t.
struct KeyData {
  var key: UInt32 = 0
  var vers = (UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt16(0))
  var pLimit = (UInt16(0), UInt16(0), UInt32(0), UInt32(0), UInt32(0))
  var keyInfo = (UInt32(0), UInt32(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0)) // C pads this struct to 12 bytes
  var result: UInt8 = 0, status: UInt8 = 0, data8: UInt8 = 0
  var data32: UInt32 = 0
  var bytes: (UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
              UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8) =
    (0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)
}
func fourCC(_ s: String) -> UInt32 { s.utf8.reduce(0) { $0 << 8 | UInt32($1) } }
var conn: io_connect_t = 0
let svc = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"))
let smcOpen = IOServiceOpen(svc, mach_task_self_, 0, &conn) == KERN_SUCCESS
func call(_ i: inout KeyData) -> Bool {
  guard smcOpen else { return false }
  var o = KeyData(); var size = MemoryLayout<KeyData>.stride
  let r = IOConnectCallStructMethod(conn, 2, &i, MemoryLayout<KeyData>.stride, &o, &size)
  i = o; return r == KERN_SUCCESS && o.result == 0
}
func read(_ k: String) -> (type: String, bytes: [UInt8])? {
  var i = KeyData(); i.key = fourCC(k); i.data8 = 9 // get key info
  guard call(&i) else { return nil }
  let size = i.keyInfo.0, type = i.keyInfo.1
  var r = KeyData(); r.key = fourCC(k); r.keyInfo.0 = size; r.data8 = 5 // read
  guard call(&r) else { return nil }
  let t = String(bytes: withUnsafeBytes(of: type.bigEndian) { Array($0) }, encoding: .ascii) ?? "?"
  return (t, withUnsafeBytes(of: r.bytes) { Array($0.prefix(Int(size))) })
}
func num(_ k: String) -> Double? {
  guard let (t, b) = read(k) else { return nil }
  if t == "flt " { return Double(b.withUnsafeBytes { $0.load(as: Float.self) }) }
  if t == "ui8 " { return Double(b[0]) }
  if t == "fpe2" { return Double(UInt16(b[0]) << 6 | UInt16(b[1]) >> 2) }
  return nil
}

var fans: [[String: Int]] = []
for f in 0..<Int(num("FNum") ?? 0) {
  guard let rpm = num("F\(f)Ac") else { continue }
  fans.append(["rpm": Int(rpm), "min": Int(num("F\(f)Mn") ?? 0), "max": Int(num("F\(f)Mx") ?? 0)])
}
var out: [String: Any] = ["fans": fans]
if let t = chipTemp() { out["cpu"] = (t * 10).rounded() / 10 }
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
