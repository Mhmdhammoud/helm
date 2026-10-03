// mediakey [code]: posts a hardware media-key press (NX_KEYTYPE_*: 0/1 sound up/down, 7 mute,
// 2/3 brightness up/down, 16 play/pause, 17 next, 18 previous). Volume keys show the macOS HUD.
// AppleScript/JXA can't post these, so the bridge compiles this on first use.
// With no argument it stays running and reads one code per line from stdin, answering "ok" per key,
// so a press costs a couple of ms instead of a process launch.
import AppKit

func post(_ key: Int32) {
  for down in [true, false] {
    let ev = NSEvent.otherEvent(
      with: .systemDefined, location: .zero,
      modifierFlags: NSEvent.ModifierFlags(rawValue: down ? 0xa00 : 0xb00),
      timestamp: 0, windowNumber: 0, context: nil, subtype: 8,
      data1: Int((key << 16) | ((down ? 0xa : 0xb) << 8)), data2: -1)
    ev?.cgEvent?.post(tap: .cghidEventTap)
  }
}

if CommandLine.arguments.count == 2 {
  guard let key = Int32(CommandLine.arguments[1]) else { exit(2) }
  post(key)
} else {
  setvbuf(stdout, nil, _IOLBF, 0)
  usleep(200_000) // a just-launched process's first events get dropped; lines wait in the pipe meanwhile
  while let line = readLine() { // ends when the bridge goes away
    if let key = Int32(line.trimmingCharacters(in: .whitespaces)) { post(key); usleep(8_000); print("ok") } else { print("bad") }
  }
}
