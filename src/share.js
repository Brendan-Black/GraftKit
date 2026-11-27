// The share: what a friend's Mac talks to over the local network. It serves the sync, debug and launcher-setup scripts,
// the mod list, Graft and the published mods, and accepts reports. The scripts are fixed files with one slot, filled
// only with this machine's own address (see arrivalBase).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { ROOT } = require('./config');
const mods = require('./mods');

const MAC = path.join(ROOT, 'mac');
const MAX_REPORT = 2_000_000;

/** LAN addresses worth telling a friend about: no loopback, link-local or WSL/Hyper-V adapters. */
function lanAddresses() {
  const out = [];
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.') && !/vEthernet|WSL|Hyper-V/i.test(ifname)) out.push({ ifname, address: a.address });
    }
  }
  return out;
}

/**
 * The share's own address that a request arrived on, as http://<ipv4>:<port>: one of this machine's addresses, as the
 * OS reports the connection, never anything the request says (its Host header is ignored). Null if it isn't one.
 */
function arrivalBase(req) {
  const local = String(req.socket.localAddress || '').replace(/^::ffff:/, '');
  const own = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4').map((a) => a.address);
  if (!own.includes(local)) return null;
  const base = `http://${local}:${req.socket.localPort}`;
  return /^http:\/\/\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(base) ? base : null;
}

// The one slot in the served scripts. Everything else in them is fixed, and the slot only ever receives a value from
// arrivalBase(): an address from this machine's own interface list, checked against a pattern with no shell
// metacharacters, and inside single quotes in the script. That's what lets a friend run plain `curl ... | bash`.
const SLOT = '@SHARE_URL@';
function script(name, base) {
  const text = fs.readFileSync(path.join(MAC, name), 'utf8');
  return base ? text.replace(SLOT, base) : text; // no address: the script stops at its own usage message
}

function instructions(base, m) {
  const host = base.replace(/^http:\/\//, '').replace(/:\d+$/, '');
  return [
    `GraftKit on ${host}: Minecraft ${m.minecraft} with Graft and ${m.mods.length} mod(s):`,
    ...m.mods.map((x) => `  - ${x.file}`),
    '',
    'Set up or update this Mac (quit the Minecraft Launcher first). In Terminal:',
    `  curl -fsSL ${base}/sync | bash`,
    '',
    'It installs Graft and the mods, removes old ones it installed, and adds a',
    `"${m.profileName}" installation to the launcher. Then pick that installation and join ${host}.`,
    '',
    'If the game crashes, this sends a debug report back:',
    `  curl -fsSL ${base}/debug | bash`,
    '',
  ].join('\n');
}

function manifestText(m) {
  return [`minecraft\t${m.minecraft}`, `profile\t${m.profileName}`, `graft\t${m.graft.sha256}\t${m.graft.size}\tgraft.jar`,
    ...m.mods.map((x) => `mod\t${x.sha256}\t${x.size}\t${x.file}\t${x.id}\t${x.version}`)].join('\n') + '\n';
}

/** The request handler. onEvent gets {time, ip, what, ...} for each thing a Mac does. */
function createShare(cfg, onEvent) {
  const reportsDir = path.join(cfg.dataDir, 'reports');
  return (req, res) => {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const event = (what, extra = {}) => onEvent({ time: Date.now(), ip, what, ...extra });
    const send = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    const route = new URL(req.url, 'http://x').pathname;
    const kind = (new URL(req.url, 'http://x').searchParams.get('kind') || 'report').replace(/[^a-z]/g, '').slice(0, 12) || 'report';
    const fileFor = (name) => path.join(MAC, name);

    let m;
    try {
      m = mods.manifest(cfg);
    } catch (e) {
      event('error', { message: e.message });
      send(500, `the share can't list its mods: ${e.message}\n`);
      return;
    }

    if (req.method === 'POST' && route === '/report') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= MAX_REPORT) chunks.push(c); });
      req.on('end', () => {
        if (size > MAX_REPORT) { send(413, 'report too large\n'); return; }
        const body = Buffer.concat(chunks);
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}.txt`;
        fs.mkdirSync(reportsDir, { recursive: true });
        fs.writeFileSync(path.join(reportsDir, `.${name}.part`), body);
        fs.renameSync(path.join(reportsDir, `.${name}.part`), path.join(reportsDir, name));
        event(kind, { report: name, summary: body.toString('utf8').split('\n')[0].slice(0, 160) });
        send(200, 'Report received. Thanks!\n');
      });
      return;
    }
    if (req.method !== 'GET') { send(405, 'method not allowed\n'); return; }

    const base = arrivalBase(req);
    if (route === '/') { event('instructions'); send(200, instructions(base || `http://<this pc>:${cfg.sharePort}`, m)); return; }
    if (route === '/sync' || route === '/debug') { event(route.slice(1)); send(200, script(`${route.slice(1)}.sh`, base)); return; }
    if (route === '/profile.js') { send(200, fs.readFileSync(fileFor('profile.js')), 'application/javascript'); return; }
    if (route === '/manifest.txt') { send(200, manifestText(m)); return; }

    let file = null;
    if (route === '/files/graft.jar') file = cfg.graftJar;
    const mm = route.match(/^\/files\/mods\/([^/]+)$/);
    if (mm) {
      const name = decodeURIComponent(mm[1]);
      if (m.mods.some((x) => x.file === name)) file = path.join(cfg.modsDir, name); // only files the manifest lists
    }
    if (!file) { send(404, 'not found\n'); return; }
    event('download', { file: path.basename(file) });
    res.writeHead(200, { 'Content-Type': 'application/java-archive', 'Content-Length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  };
}

/** Starts the share on every interface; the firewall rule (added separately) admits local networks only. */
function listen(cfg, onEvent, port = cfg.sharePort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createShare(cfg, onEvent));
    server.once('error', (e) => reject(new Error(`can't share on port ${port}: ${e.message}`, { cause: e })));
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

module.exports = { createShare, listen, lanAddresses, manifestText, SLOT };
