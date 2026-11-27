// The Minecraft server: whether it's up, stopping it through RCON, and following its log.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { readProps } from './config.ts';

export function gamePort(serverDir: string): number { return Number(readProps(serverDir)['server-port'] || 25565); }

/** True when something accepts connections on the server's game port. */
export function isUp(serverDir: string, host = '127.0.0.1'): Promise<boolean> {
  const port = gamePort(serverDir);
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.setTimeout(800, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false)); // refused or unreachable: that is the answer "not up"
  });
}

/**
 * Follows logs/latest.log: onLines gets the last `backlog` lines once, then new lines as they're written. A new log
 * after a restart is picked up from its start. Returns a function that stops following.
 */
export function followLog(serverDir: string, onLines: (lines: string[]) => void, { backlog = 200, everyMs = 500 } = {}): () => void {
  const file = path.join(serverDir, 'logs', 'latest.log');
  let pos = 0, carry = '', first = true;
  const readNew = () => {
    if (!fs.existsSync(file)) return; // no log yet: the server hasn't run; keep waiting for one
    const size = fs.statSync(file).size;
    if (size < pos) { pos = 0; carry = ''; }
    if (size === pos) return;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      pos = size;
      const lines = (carry + buf.toString('utf8')).split(/\r?\n/);
      carry = lines.pop() ?? '';
      onLines(first ? lines.slice(-backlog) : lines);
      first = false;
    } finally {
      fs.closeSync(fd);
    }
  };
  readNew();
  const timer = setInterval(readNew, everyMs);
  return () => clearInterval(timer);
}
