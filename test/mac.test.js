// The Mac side: the launcher setup's JSON transform, and sync.sh run for real in bash against a live share, with
// macOS-only tools (shasum, osascript, pgrep) replaced by pseudos on PATH.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { upsert } = require('../mac/profile');
const share = require('../src/share');
const { tempServer, graftMod } = require('./helpers');

const NOW = '2026-11-26T00:00:00.000Z';

test('the launcher installation is added without touching the others', () => {
  const before = JSON.stringify({ profiles: { a: { name: 'Latest', type: 'latest-release' } }, settings: { x: 1 } });
  const after = JSON.parse(upsert(before, '/Users/x/graft/graft.jar', '26.3', 'Graft (26.3)', NOW));
  assert.deepEqual(after.profiles.a, { name: 'Latest', type: 'latest-release' });
  assert.deepEqual(after.settings, { x: 1 });
  const p = after.profiles.graftkit;
  assert.equal(p.lastVersionId, '26.3');
  assert.equal(p.type, 'custom');
  assert.match(p.javaArgs, /^-javaagent:\/Users\/x\/graft\/graft\.jar -Xmx4G /);
});

test('running it again repairs the agent path and keeps the player\'s own JVM settings', () => {
  const before = JSON.stringify({ profiles: { graftkit: { name: 'old', javaArgs: '-Xmx8G -javaagent:/Users/typo/graft/graft.jar -XX:+UseZGC', created: 'then' } } });
  const p = JSON.parse(upsert(before, '/Users/x/graft/graft.jar', '26.3', 'Graft (26.3)', NOW)).profiles.graftkit;
  assert.equal(p.javaArgs, '-javaagent:/Users/x/graft/graft.jar -Xmx8G -XX:+UseZGC');
  assert.equal(p.created, 'then');
  assert.equal(p.name, 'Graft (26.3)');
});

test('a damaged launcher file is refused, not overwritten', () => {
  assert.throws(() => upsert('{ not json', '/a', '26.3', 'n', NOW), /not valid JSON/);
  assert.ok(JSON.parse(upsert('', '/a', '26.3', 'n', NOW)).profiles.graftkit);
});

const tools = ['bash', 'curl', 'sha256sum', 'grep', 'mktemp'];
const missing = tools.filter((t) => spawnSync('sh', ['-c', `command -v ${t}`]).status !== 0);
const needsTools = missing.length ? `needs ${missing.join(', ')}` : false; // node:test skips on any non-false value, even 0
// Exactly what a friend types: curl the script from the share and pipe it to bash, with no arguments.
const runSync = (base, home, bin) => new Promise((resolve) => {
  const p = spawn('bash', ['-c', 'curl -fsSL "$0/sync" | bash', base], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, TMPDIR: home } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

test('sync.sh installs Graft and the mods, sets up the launcher, then follows the server\'s changes', { skip: needsTools }, async (t) => {
  const { cfg } = tempServer(t);
  fs.writeFileSync(path.join(cfg.modsDir, 'zoom-1.0.jar'), graftMod('zoom', '1.0'));
  const server = await share.listen(cfg, () => {}, 0);
  t.after(() => new Promise((res) => { server.closeAllConnections(); server.close(res); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'graftkit-mac-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  const tool = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  tool('shasum', '[ "$1" = "-a" ] && shift 2; exec sha256sum "$@"');
  tool('pgrep', 'exit 1');
  // osascript -l JavaScript <script> <file> <agent> <version> <name>: run the same upsert() under Node.
  tool('osascript', `exec node -e 'const fs=require("fs");const {upsert}=require(${JSON.stringify(path.join(__dirname, '..', 'mac', 'profile.js'))});const [,f,a,v,n]=process.argv.slice(1);fs.writeFileSync(f, upsert(fs.existsSync(f)?fs.readFileSync(f,"utf8"):"", a, v, n, "now"))' -- "$3" "$4" "$5" "$6" "$7"`);
  const mc = path.join(home, 'Library', 'Application Support', 'minecraft');

  const first = await runSync(base, home, bin);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /Graft: installed/);
  assert.match(first.out, /\+ zoom-1\.0\.jar/);
  assert.ok(fs.existsSync(path.join(home, 'graft', 'graft.jar')));
  const profile = JSON.parse(fs.readFileSync(path.join(mc, 'launcher_profiles.json'), 'utf8')).profiles.graftkit;
  assert.equal(profile.javaArgs.split(' ')[0], `-javaagent:${path.join(home, 'graft', 'graft.jar')}`);

  // The server swaps zoom 1.0 for 1.1, and the friend has a stray jar of their own.
  fs.rmSync(path.join(cfg.modsDir, 'zoom-1.0.jar'));
  fs.writeFileSync(path.join(cfg.modsDir, 'zoom-1.1.jar'), graftMod('zoom', '1.1'));
  fs.writeFileSync(path.join(mc, 'mods', 'theirs.jar'), 'x');
  const second = await runSync(base, home, bin);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /Graft: up to date/);
  assert.match(second.out, /- zoom-1\.0\.jar \(no longer on the server\)/);
  assert.match(second.out, /! theirs\.jar isn't on the server/);
  assert.deepEqual(fs.readdirSync(path.join(mc, 'mods')).sort(), ['theirs.jar', 'zoom-1.1.jar']);
});

test('sync.sh refuses a missing or odd address', { skip: needsTools }, () => {
  for (const arg of [[], ['http://x;rm -rf ~'], ['https://x']]) {
    const r = spawnSync('bash', [path.join(__dirname, '..', 'mac', 'sync.sh'), ...arg], { encoding: 'utf8' });
    assert.equal(r.status, 2, String(arg));
    assert.match(r.stdout, /usage:/);
  }
});
