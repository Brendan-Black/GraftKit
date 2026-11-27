// The web dashboard, on 127.0.0.1 only. API calls need a random token that is embedded in the page, and the Host
// header must be local, so other websites open in the same browser can't drive the server. The dashboard also owns
// the share (on and off) for friends' Macs.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { ROOT } = require('./config');
const mods = require('./mods');
const server = require('./server');
const share = require('./share');
const windows = require('./windows');
const { parseArgs } = require('./actions/util');

const shareRule = (cfg) => `GraftKit share ${cfg.sharePort}`;
const MAX_BODY = 64 * 1024;

function createState() {
  return { events: [], shareServer: null, shareBusy: false, build: null, logLines: [], logClients: new Set(), rcon: null };
}

function note(st, what, extra = {}) {
  st.events.push({ time: Date.now(), what, ...extra });
  if (st.events.length > 300) st.events.splice(0, st.events.length - 300);
}

async function shareOn(ctx, st) {
  if (st.shareServer || st.shareBusy) return;
  st.shareBusy = true;
  try {
    await windows.firewall(ctx.cfg, { open: true, name: shareRule(ctx.cfg), port: ctx.cfg.sharePort, program: process.execPath });
    try {
      st.shareServer = await share.listen(ctx.cfg, (e) => note(st, e.what, e));
    } catch (e) {
      await windows.firewall(ctx.cfg, { open: false, name: shareRule(ctx.cfg) }); // don't leave a port open for nothing
      throw e;
    }
    note(st, 'share-on');
  } finally {
    st.shareBusy = false;
  }
}

async function shareOff(ctx, st) {
  if (!st.shareServer || st.shareBusy) return;
  st.shareBusy = true;
  try {
    await new Promise((resolve) => st.shareServer.close(() => resolve()));
    st.shareServer = null;
    await windows.firewall(ctx.cfg, { open: false, name: shareRule(ctx.cfg) });
    note(st, 'share-off');
  } finally {
    st.shareBusy = false;
  }
}

/** 'yes' when mods changed after the server started (its log was created then), 'no', or 'unknown'. */
function restartNeeded(cfg, up) {
  if (!up) return 'no';
  const log = path.join(cfg.serverDir, 'logs', 'latest.log');
  if (!fs.existsSync(log) || !fs.existsSync(cfg.modsDir)) return 'unknown';
  const started = fs.statSync(log).birthtimeMs;
  const changed = fs.statSync(cfg.modsDir).mtimeMs > started || mods.published(cfg).some((m) => m.modified > started);
  return changed ? 'yes' : 'no';
}

async function rconFor(ctx, st) {
  if (!st.rcon || st.rcon.closed) st.rcon = await ctx.connect();
  return st.rcon;
}

/** One part of the state; a part that fails reports its error instead of sinking the whole page. */
async function part(fn) {
  try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e.message }; }
}

async function snapshot(ctx, st) {
  const { cfg } = ctx;
  const up = await server.isUp(cfg.serverDir);
  const players = up ? await part(async () => {
    const list = await (await rconFor(ctx, st)).send('list');
    return (list.split(':')[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
  }) : { ok: true, value: [] };
  const reportsDir = path.join(cfg.dataDir, 'reports');
  const strip = (m) => ({ file: m.file, size: m.size, modified: m.modified, path: m.path, kind: m.kind, info: m.info || null, reason: m.reason || null });
  return {
    server: { up, players, restartNeeded: restartNeeded(cfg, up), dir: cfg.serverDir },
    share: { on: !!st.shareServer, busy: st.shareBusy, port: cfg.sharePort, addresses: share.lanAddresses() },
    mods: await part(() => ({ published: mods.published(cfg).map(strip), disabled: mods.disabled(cfg).map(strip) })),
    projects: await part(() => mods.projects(cfg).map((p) => ({ name: p.name, dir: p.dir, built: p.built ? strip(p.built) : null }))),
    build: st.build && { project: st.build.project, code: st.build.code, lines: st.build.lines.slice(-40) },
    events: st.events.slice(-60).reverse(),
    reports: fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter((f) => !f.startsWith('.')).sort().reverse().slice(0, 15) : [],
    minecraft: cfg.minecraft,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('end', () => {
      if (size > MAX_BODY) { reject(new Error('request too large')); return; }
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(new Error(`bad JSON: ${e.message}`, { cause: e })); }
    });
    req.on('error', reject);
  });
}

/** Splits a toolkit line like a shell would for plain words and "quoted text", without running anything. */
function splitLine(line) {
  return (String(line).match(/"[^"]*"|\S+/g) || []).map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s));
}

function createDashboard(ctx) {
  const { cfg } = ctx;
  const st = createState();
  const token = crypto.randomBytes(24).toString('hex');
  const html = fs.readFileSync(path.join(ROOT, 'ui', 'index.html'), 'utf8');
  const page = html.replace('__TOKEN__', token); // the token is hex, so it can't break out of its attribute
  const stopLog = server.followLog(cfg.serverDir, (lines) => {
    if (!lines.length) return;
    st.logLines.push(...lines);
    if (st.logLines.length > 2000) st.logLines.splice(0, st.logLines.length - 2000);
    const msg = `data: ${JSON.stringify(lines)}\n\n`;
    for (const res of st.logClients) res.write(msg);
  }, { backlog: 300 });

  const api = {
    'GET /api/state': () => snapshot(ctx, st),
    'POST /api/server/start': async () => {
      if (await server.isUp(cfg.serverDir)) return { already: true };
      windows.startServer(cfg);
      note(st, 'server-start');
      return { ok: true };
    },
    'POST /api/server/stop': async () => {
      const out = await (await rconFor(ctx, st)).send('stop');
      note(st, 'server-stop');
      return { out };
    },
    'POST /api/share/on': async () => { await shareOn(ctx, st); return { ok: true }; },
    'POST /api/share/off': async () => { await shareOff(ctx, st); return { ok: true }; },
    'POST /api/console': async (b) => {
      const cmd = String(b.cmd || '').trim();
      if (!cmd) return { out: '' };
      return { out: await (await rconFor(ctx, st)).send(cmd) };
    },
    'POST /api/toolkit': async (b) => {
      const { ACTIONS } = require('./cli');
      const opts = parseArgs(splitLine(b.line));
      const fn = ACTIONS[opts._[0]];
      if (!fn) throw new Error(`unknown action "${opts._[0] || ''}"; try ${Object.keys(ACTIONS).join(', ')}`);
      return { out: (await fn(ctx, opts)).join('\n') };
    },
    'POST /api/mods/publish': async (b) => { const r = mods.publish(cfg, String(b.path)); note(st, 'publish', r); return r; },
    'POST /api/mods/unpublish': async (b) => { mods.unpublish(cfg, b.file); note(st, 'unpublish', { file: b.file }); return { ok: true }; },
    'POST /api/mods/republish': async (b) => { const r = mods.republish(cfg, b.file); note(st, 'publish', r); return r; },
    'POST /api/mods/build': async (b) => {
      if (st.build && st.build.code === null) throw new Error('a build is already running');
      const project = mods.projects(cfg).find((p) => p.dir === b.dir);
      if (!project) throw new Error('unknown project');
      st.build = { project: project.name, lines: [], code: null };
      mods.build(project.dir, (l) => st.build.lines.push(l)).then((code) => {
        st.build.code = code;
        if (code !== 0) { note(st, 'build-failed', { project: project.name }); return; }
        const built = mods.projects(cfg).find((p) => p.dir === b.dir)?.built;
        if (!built) { note(st, 'build-failed', { project: project.name, message: 'no Graft mod jar in build/libs' }); return; }
        note(st, 'publish', mods.publish(cfg, built.path));
      }).catch((e) => { st.build.code = -1; note(st, 'build-failed', { project: project.name, message: e.message }); });
      return { ok: true };
    },
    'GET /api/report': async (b, url) => {
      const name = url.searchParams.get('name') || '';
      if (!/^[\w.-]+\.txt$/.test(name)) throw new Error('bad report name');
      return { text: fs.readFileSync(path.join(cfg.dataDir, 'reports', name), 'utf8') };
    },
  };

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403).end('forbidden'); return; }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
      res.end(page);
      return;
    }
    const given = String(req.headers['x-graftkit-token'] || url.searchParams.get('token') || '');
    if (given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) { res.writeHead(401).end('missing token'); return; }
    if (req.method === 'GET' && url.pathname === '/api/log') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(st.logLines.slice(-300))}\n\n`);
      st.logClients.add(res);
      req.on('close', () => st.logClients.delete(res));
      return;
    }
    const fn = api[`${req.method} ${url.pathname}`];
    if (!fn) { res.writeHead(404).end('not found'); return; }
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await fn(body, url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  const close = async () => {
    stopLog();
    if (st.rcon) st.rcon.close();
    for (const c of st.logClients) c.end();
    await shareOff(ctx, st);
    await new Promise((resolve) => httpServer.close(() => resolve()));
  };
  return { httpServer, st, token, close };
}

async function run(ctx, opts) {
  const d = createDashboard(ctx);
  await new Promise((resolve, reject) => {
    d.httpServer.once('error', (e) => reject(new Error(`can't open the dashboard on port ${ctx.cfg.dashboardPort}: ${e.message}`, { cause: e })));
    d.httpServer.listen(ctx.cfg.dashboardPort, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${ctx.cfg.dashboardPort}/`;
  console.log(`GraftKit dashboard: ${url}  (Ctrl+C quits; sharing is switched off first)`);
  if (!opts['no-open']) windows.openBrowser(url);
  const quit = async () => {
    try {
      await d.close();
      process.exit(0);
    } catch (e) {
      console.error(`graftkit: while closing: ${e.message}. Check that the firewall rule "${shareRule(ctx.cfg)}" is gone.`);
      process.exit(1);
    }
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  return new Promise(() => {}); // serves until Ctrl+C
}

/** graftkit share: only the share, in the foreground, printing what Macs do. */
async function shareForeground(ctx) {
  const st = createState();
  await shareOn(ctx, st);
  const lines = share.lanAddresses().map((a) => `  curl -fsSL http://${a.address}:${ctx.cfg.sharePort}/sync | bash    (${a.ifname})`);
  console.log(['Sharing Graft and the published mods. On the Mac, in Terminal:', ...lines, 'Ctrl+C stops sharing.'].join('\n'));
  setInterval(() => {
    for (const e of st.events.splice(0)) console.log(`${new Date(e.time).toLocaleTimeString()}  ${e.ip || ''}  ${e.what}${e.file ? ` ${e.file}` : ''}${e.summary ? ` ${e.summary}` : ''}`);
  }, 500);
  process.on('SIGINT', async () => {
    try {
      await shareOff(ctx, st);
      process.exit(0);
    } catch (e) {
      console.error(`graftkit: ${e.message}`);
      process.exit(1);
    }
  });
  return new Promise(() => {});
}

module.exports = { run, shareForeground, createDashboard, splitLine };
