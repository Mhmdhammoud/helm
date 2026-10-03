// One long-lived osascript that runs AppleScript snippets sent as JSON lines, so a key press costs a few ms
// instead of a ~150ms osascript spawn. Commands run one at a time. If osascript can't start, the command runs
// one-shot through `exec`. If it dies or hangs mid-command, that command is reported as failed (never rerun:
// a keystroke must not fire twice) and the next command starts a fresh process. Script errors are reported.
import { spawn as realSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// stdin is ASCII-only (the bridge escapes everything else), so chunk boundaries can't split a character.
// The `on run argv` handler gets its args through a real run event, like `osascript -e script arg…`.
// Exits when stdin closes, so it never outlives the bridge.
const RUNNER_JXA = `ObjC.import('Foundation');
const D = $.NSAppleEventDescriptor, out = $.NSFileHandle.fileHandleWithStandardOutput, cache = {};
function run1(src, args) {
  if (Object.keys(cache).length > 200) for (const k in cache) delete cache[k];
  const s = cache[src] ??= $.NSAppleScript.alloc.initWithSource($(src));
  const err = $();
  let r;
  if (args.length) {
    const ev = D.appleEventWithEventClassEventIDTargetDescriptorReturnIDTransactionID(0x61657674, 0x6f617070, D.nullDescriptor, -1, 0);
    const list = D.listDescriptor;
    args.forEach((a, i) => list.insertDescriptorAtIndex(D.descriptorWithString($(a)), i + 1));
    ev.setParamDescriptorForKeyword(list, 0x2d2d2d2d);
    r = s.executeAppleEventError(ev, err);
  } else r = s.executeAndReturnError(err);
  if (r.isNil()) throw new Error(ObjC.unwrap(err.objectForKey('NSAppleScriptErrorMessage')) || 'AppleScript error');
  return ObjC.unwrap(r.stringValue) ?? '';
}
function run() {
  const inp = $.NSFileHandle.fileHandleWithStandardInput;
  let buf = '';
  for (;;) {
    const d = inp.availableData;
    if (Number(d.length) === 0) return; // EOF: the bridge is gone (length comes back as a string)
    buf += $.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding).js;
    for (let i; (i = buf.indexOf('\\n')) >= 0; buf = buf.slice(i + 1)) {
      const c = JSON.parse(buf.slice(0, i));
      let reply;
      try { reply = { id: c.id, ok: true, out: String(run1(c.script, c.args)).trim() }; }
      catch (e) { reply = { id: c.id, ok: false, error: String(e.message || e) }; }
      out.writeData($(JSON.stringify(reply) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
    }
  }
}`;

const ascii = s => s.replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Returns `osa(script, args) → Promise<stdout>`, a drop-in for `exec('osascript', ['-e', script, ...args])`. */
export function makeOsa({ exec, spawn = realSpawn, timeoutMs = 3000 }) {
  let proc = null; // spawned on first use, and again after it dies
  let current = null;
  const queue = [];
  let ids = 0;

  function start() {
    const p = spawn('osascript', ['-l', 'JavaScript', '-e', RUNNER_JXA], { stdio: ['pipe', 'pipe', 'ignore'] });
    proc = p;
    p.unref?.(); p.stdin.unref?.(); p.stdout.unref?.(); // an idle runner never keeps node alive
    p.stdin.on('error', () => {}); // EPIPE once it's gone; 'exit' handles that
    createInterface({ input: p.stdout }).on('line', line => {
      let r;
      try { r = JSON.parse(line); } catch { return; }
      if (current?.proc !== p || current.failed || r.id !== current.id) return;
      const c = current;
      settle();
      if (r.ok) c.resolve(r.out); else c.reject(new Error(r.error));
    });
    // 'error' means osascript never started, so nothing ran and a one-shot retry is safe. 'exit' mid-command
    // means it may already have typed or pressed something, so it's reported instead of run twice.
    const died = safe => () => {
      if (proc === p) proc = null;
      if (current?.proc === p) (safe ? fallback() : fail('the script runner stopped; the action may not have run'));
    };
    p.on('exit', died(false));
    p.on('error', died(true));
  }

  function settle() {
    clearTimeout(current.timer);
    current = null;
    pump();
  }

  function fail(message) {
    const c = current;
    if (c.failed) return;
    c.failed = true;
    clearTimeout(c.timer);
    c.reject(new Error(message));
    settle();
  }

  // The runner couldn't start: run that command the old way, then carry on with the queue.
  function fallback() {
    const c = current;
    if (c.failed) return;
    c.failed = true;
    clearTimeout(c.timer);
    exec('osascript', ['-e', c.script, ...c.args]).then(c.resolve, c.reject).finally(settle);
  }

  function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    if (!proc) start();
    current.proc = proc;
    current.timer = setTimeout(() => {
      const p = proc;
      proc = null;
      p?.kill();
      fail('timed out; the action may not have finished'); // never retried: a keystroke must not fire twice
    }, timeoutMs);
    proc.stdin.write(`${ascii(JSON.stringify({ id: current.id, script: current.script, args: current.args }))}\n`);
  }

  return (script, args = []) => new Promise((resolve, reject) => {
    queue.push({ id: ++ids, script, args: args.map(String), resolve, reject });
    pump();
  });
}
