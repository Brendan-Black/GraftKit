// The Windows side: firewall rules (elevated, one UAC prompt each) and starting the server in its own console.
// The PowerShell scripts are fixed files; values reach them as arguments or a JSON request, never as code. They are
// copied next to the server first, since an elevated process may not be able to read the WSL share.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, type Config } from './config.ts';

const SCRIPTS = ['firewall.ps1', 'elevate.ps1', 'run-server.ps1', 'start-server.ps1'] as const;

type Scripts = { dir: string } & Record<(typeof SCRIPTS)[number], string>;

/** Copies the scripts into <dataDir>/win and returns their paths there. */
export function installScripts(cfg: Config): Scripts {
  const dir = path.join(cfg.dataDir, 'win');
  if (/[\s"'`$;&|<>()]/.test(dir)) throw new Error(`the server folder ${cfg.serverDir} must not contain spaces or shell characters`);
  fs.mkdirSync(dir, { recursive: true });
  const out: Partial<Scripts> = { dir };
  for (const s of SCRIPTS) {
    const to = path.join(dir, s);
    fs.copyFileSync(path.join(ROOT, 'win', s), to);
    out[s] = to;
  }
  return out as Scripts;
}

function run(cmd: string, args: string[]): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`couldn't run ${cmd}: ${e.message}`, { cause: e })));
    p.on('close', (code) => resolve({ code, err: err.trim() }));
  });
}

export interface FirewallRule { open: boolean; name: string; port?: number; program?: string }

/** Opens (or with open=false removes) an inbound rule for program on port, from local networks only. */
export async function firewall(cfg: Config, { open, name, port, program }: FirewallRule): Promise<void> {
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

/**
 * Starts the server in a console window of its own, which outlives GraftKit. start-server.ps1 opens the window and
 * exits; resolves once it has, and fails if it couldn't (spawning pwsh detached instead gives it no console, and it
 * quits without running anything).
 */
export async function startServer(cfg: Config): Promise<void> {
  const s = installScripts(cfg);
  const { code, err } = await run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', s['start-server.ps1'], '-RunServer', s['run-server.ps1'],
    '-ServerDir', cfg.serverDir, '-Ram', cfg.serverRam || '6G', '-Elevate', s['elevate.ps1'], '-Firewall', s['firewall.ps1']]);
  if (code !== 0) throw new Error(`couldn't open the server's window: ${err || `pwsh exited with ${code}`}`);
}

/** Opens a URL in the default browser. */
export function openBrowser(url: string): void {
  spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
}
