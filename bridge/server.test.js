// Runs the bridge against fake-hush.js (a copy of hush/mcp/fake-hush.js) and a stub Mac, so no real headphones, volume or apps are touched.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'helm-bridge-'));
process.env.HUSH_CLI = fileURLToPath(new URL('./fake-hush.js', import.meta.url));
process.env.HUSH_FAKE_STATE = join(dir, 'state.json');
process.env.HELM_FAKE_MAC = '1';
const { serve, parseHush } = await import('./server.js');

test('parseHush allows only the hush:// command language', () => {
  assert.deepEqual(parseHush('anc/10'), ['anc', '10']);
  assert.deepEqual(parseHush('eq/bass/-3'), ['eq', 'bass', '-3']);
  assert.deepEqual(parseHush('switch/iPad'), ['switch', 'iPad']);
  for (const bad of ['anc/11', 'eq/bass/12', 'rm/-rf', 'selfvoice/loud', 'switch/a/b', '', undefined]) {
    assert.equal(parseHush(bad), null, String(bad));
  }
});

test('bridge requires the token and drives headphones + Mac', async t => {
  const server = await serve({ port: 0, secret: 's3cret' });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, auth = 'Bearer s3cret') =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });

  assert.equal((await call('/state', null, 'Bearer nope')).status, 401);
  assert.equal((await call('/state', null, '')).status, 401);

  let s = await (await call('/state')).json();
  assert.equal(s.headphones.anc.level, 5);
  assert.deepEqual(s.mac, { volume: 50, micMuted: false });

  assert.equal((await call('/hush', { cmd: 'anc/9' })).status, 200);
  assert.equal((await call('/hush', { cmd: 'conversation/on' })).status, 200);
  assert.equal((await call('/hush', { cmd: 'anc/99' })).status, 400);
  s = await (await call('/state')).json();
  assert.equal(s.headphones.anc.level, 9);
  assert.equal(s.headphones.conversation, true);

  const r = await (await call('/mac', { action: 'mic' })).json();
  assert.equal(r.mac.micMuted, true);
  assert.equal((await call('/mac', { action: 'shutdown' })).status, 400);
});
