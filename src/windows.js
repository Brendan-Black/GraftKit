// The Windows side: firewall rules (elevated, one UAC prompt each) and starting the server in its own console.
// The PowerShell scripts are fixed files; values reach them as arguments or a JSON request, never as code. They are
// copied next to the server first, since an elevated process may not be able to read the WSL share.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT } = require('./config');

const SCRIPTS = ['firewall.ps1', 'elevate.ps1', 'run-server.ps1'];

/** Copies the scripts into <dataDir>/win and returns their paths there. */
function installScripts(cfg) {
  const dir = path.join(cfg.dataDir, 'win');
  if (/[\s"'`$;&|<>()]/.test(dir)) throw new Error(`the server folder ${cfg.serverDir} must not contain spaces or shell characters`);
  fs.mkdirSync(dir, { recursive: true });
  const out = {};
  for (const s of SCRIPTS) {
    const to = path.join(dir, s);
    fs.copyFileSync(path.join(ROOT, 'win', s), to);
    out[s] = to;
  }
  return { dir, ...out };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`couldn't run ${cmd}: ${e.message}`, { cause: e })));
    p.on('close', (code) => resolve({ code, err: err.trim() }));
  });
}

/** Opens (or with open=false removes) an inbound rule for program on port, from local networks only. */
async function firewall(cfg, { open, name, port, program }) {
  const s = installScripts(cfg);
  const request = path.join(s.dir, `fw-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(request, JSON.stringify({ action: open ? 'open' : 'close', name, port, program }));
  try {
    const { code, err } = await run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', s['elevate.ps1'], '-Script', s['firewall.ps1'], '-Request', request]);
    const result = fs.existsSync(`${request}.result`) ? fs.readFileSync(`${request}.result`, 'utf8').trim() : null;
    if (result !== 'ok') throw new Error(`firewall rule "${name}" (${open ? 'open' : 'close'}): ${result || err || `no answer (exit ${code}); was the admin prompt declined?`}`);
  } finally {
    fs.rmSync(request, { force: true });
    fs.rmSync(`${request}.result`, { force: true });
  }
}

/** Starts the server in a console window of its own, which outlives GraftKit. */
function startServer(cfg) {
  const s = installScripts(cfg);
  const child = spawn('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', s['run-server.ps1'], '-ServerDir', cfg.serverDir,
    '-Ram', cfg.serverRam || '6G', '-Elevate', s['elevate.ps1'], '-Firewall', s['firewall.ps1']], { detached: true, stdio: 'ignore' });
  child.unref();
}

/** Opens a URL in the default browser. */
function openBrowser(url) {
  spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { firewall, startServer, openBrowser, installScripts };
