// Login-item wrapper: `helm-bridge <node> <server.js>` runs the bridge as a child process, so macOS asks
// for (and remembers) Accessibility under "Helm Bridge" instead of `node`. Exec'ing node would hand the
// identity back to node, and granting node Accessibility would let every node script on the Mac type keys.
import ApplicationServices
import Foundation

// Shows the "Helm Bridge would like to control this computer" prompt the first time, then does nothing.
_ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 1 else { fputs("usage: helm-bridge <node> <server.js>\n", stderr); exit(2) }
let child = Process()
child.executableURL = URL(fileURLWithPath: args[0])
child.arguments = Array(args.dropFirst())

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
