const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const share = require('../src/share');
const { tempServer, graftMod } = require('./helpers');

async function startShare(t, cfg) {
  const events = [];
  const server = await share.listen(cfg, (e) => events.push(e), 0);
  t.after(() => new Promise((res) => { server.closeAllConnections(); server.close(res); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, text: await r.text() }));
  return { base, events, get };
}

test('the manifest names Minecraft, the launcher installation, Graft and each mod', async (t) => {
  const { cfg } = tempServer(t);
  fs.writeFileSync(path.join(cfg.modsDir, 'zoom-1.0.jar'), graftMod('zoom', '1.0'));
  const { get } = await startShare(t, cfg);
  const lines = (await get('/manifest.txt')).text.trim().split('\n').map((l) => l.split('\t'));
  assert.deepEqual(lines[0], ['minecraft', '26.3']);
  assert.deepEqual(lines[1], ['profile', 'Graft (26.3)']);
  assert.equal(lines[2][0], 'graft');
  assert.deepEqual([lines[3][0], lines[3][3], lines[3][4], lines[3][5]], ['mod', 'zoom-1.0.jar', 'zoom', '1.0']);
});

test('the instructions give the exact command, with the address it was reached on', async (t) => {
  const { cfg } = tempServer(t);
  const { base, get } = await startShare(t, cfg);
  assert.ok((await get('/')).text.includes(`curl -fsSL ${base}/sync | bash`));
});

test('the scripts are served as written, with only the slot filled: the address the Mac connected to', async (t) => {
  const { cfg } = tempServer(t);
  const { base, get } = await startShare(t, cfg);
  for (const name of ['sync', 'debug']) {
    const file = fs.readFileSync(path.join(__dirname, '..', 'mac', `${name}.sh`), 'utf8');
    assert.equal(file.split(share.SLOT).length, 2, `${name}.sh has exactly one slot`);
    assert.equal((await get(`/${name}`)).text, file.replace(share.SLOT, base));
  }
});

test('the slot never takes what the request says about itself', async (t) => {
  const { cfg } = tempServer(t);
  const server = await share.listen(cfg, () => {}, 0);
  t.after(() => new Promise((res) => { server.closeAllConnections(); server.close(res); }));
  const body = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/sync', headers: { Host: "evil.com';touch /tmp/x;'" } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b));
    }).on('error', reject);
  });
  assert.ok(!body.includes('evil.com'));
  assert.ok(body.includes(`SHARE_URL='http://127.0.0.1:${server.address().port}'`));
});

test('only files the manifest lists can be downloaded', async (t) => {
  const { cfg } = tempServer(t);
  fs.writeFileSync(path.join(cfg.modsDir, 'zoom-1.0.jar'), graftMod('zoom', '1.0'));
  fs.writeFileSync(path.join(cfg.serverDir, 'secret.jar'), 'x');
  const { get, events } = await startShare(t, cfg);
  assert.equal((await get('/files/mods/zoom-1.0.jar')).status, 200);
  assert.equal((await get('/files/graft.jar')).status, 200);
  for (const p of ['/files/mods/..%2Fsecret.jar', '/files/mods/secret.jar', '/files/server.properties', '/files/mods/']) assert.equal((await get(p)).status, 404, p);
  assert.deepEqual(events.filter((e) => e.what === 'download').map((e) => e.file), ['zoom-1.0.jar', 'graft.jar']);
});

test('reports are saved whole and announced', async (t) => {
  const { cfg } = tempServer(t);
  const { base, events } = await startShare(t, cfg);
  const r = await fetch(`${base}/report?kind=sync`, { method: 'POST', body: 'sync ok: +1\nmore lines' });
  assert.equal(r.status, 200);
  const saved = fs.readdirSync(path.join(cfg.dataDir, 'reports'));
  assert.equal(saved.length, 1);
  assert.match(saved[0], /-sync\.txt$/);
  assert.equal(fs.readFileSync(path.join(cfg.dataDir, 'reports', saved[0]), 'utf8'), 'sync ok: +1\nmore lines');
  assert.equal(events.at(-1).summary, 'sync ok: +1');
});

test('an odd Host header never becomes the address in the instructions', async (t) => {
  const { cfg } = tempServer(t);
  const server = await share.listen(cfg, () => {}, 0);
  t.after(() => new Promise((res) => { server.closeAllConnections(); server.close(res); }));
  const text = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/', headers: { Host: 'evil.com;rm -rf' } }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  assert.ok(!text.includes('evil.com'));
});
