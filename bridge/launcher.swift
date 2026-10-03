// Login-item wrapper: `helm-bridge <node> <server.js>` runs the bridge as a child process, so macOS asks
// for (and remembers) Accessibility under "Helm Bridge" instead of `node`. Exec'ing node would hand the
// identity back to node, and granting node Accessibility would let every node script on the Mac type keys.
import ApplicationServices
import Foundation
import UserNotifications

// `helm-bridge --notify <title> <body>`: the bridge posts its notifications (pairing codes) through here, so
// they carry Helm's name and icon. Exits 1 if notifications aren't allowed, and the bridge falls back.
if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--notify" {
  let center = UNUserNotificationCenter.current()
  let done = DispatchSemaphore(value: 0)
  var shown = false
  center.requestAuthorization(options: [.alert, .sound]) { ok, _ in
    guard ok else { done.signal(); return }
    let n = UNMutableNotificationContent()
    n.title = CommandLine.arguments[2]
    n.body = CommandLine.arguments[3]
    n.sound = .default
    center.add(UNNotificationRequest(identifier: "helm", content: n, trigger: nil)) { err in shown = err == nil; done.signal() }
  }
  _ = done.wait(timeout: .now() + 60) // the first time, this waits for the user to answer the permission prompt
  exit(shown ? 0 : 1)
}

// Shows the "Helm Bridge would like to control this computer" prompt the first time, then does nothing.
_ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 1 else { fputs("usage: helm-bridge <node> <server.js>\n", stderr); exit(2) }
let child = Process()
child.executableURL = URL(fileURLWithPath: args[0])
child.arguments = Array(args.dropFirst())
child.environment = ProcessInfo.processInfo.environment.merging(["HELM_NOTIFIER": CommandLine.arguments[0]]) { $1 }

var sources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
  signal(sig, SIG_IGN)
  let s = DispatchSource.makeSignalSource(signal: sig, queue: .global())
  s.setEventHandler { child.terminate() }
  s.resume()
  sources.append(s)
}

do { try child.run() } catch { fputs("helm-bridge: \(error)\n", stderr); exit(1) }
child.waitUntilExit()
exit(child.terminationStatus)
