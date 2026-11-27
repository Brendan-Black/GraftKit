// RCON client. Long replies arrive as several packets with one id; after a command's first reply packet we send a
// marker packet of an unknown type, which the server answers only after the whole reply. The vanilla server handles
// one packet per read, so the marker is never sent together with the command.
import net from 'node:net';
import { readProps } from './config.ts';

const AUTH = 3, COMMAND = 2, MARKER_TYPE = 99;

export function packet(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + payload.length);
  buf.writeInt32LE(10 + payload.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  payload.copy(buf, 12);
  return buf;
}

export interface RconSettings { port: number; password: string; host?: string }

/** The RCON port and password from a server's server.properties. */
export function rconSettings(serverDir: string): RconSettings {
  const props = readProps(serverDir);
  if (props['enable-rcon'] !== 'true' || !props['rcon.password']) throw new Error(`RCON isn't enabled in ${serverDir}\\server.properties`);
  return { port: Number(props['rcon.port'] || 25575), password: props['rcon.password'] };
}

export class Rcon {
  /** Connects and logs in. */
  static async connect(settings: RconSettings): Promise<Rcon> {
    const r = new Rcon(settings.port, settings.host || '127.0.0.1');
    await r.open(settings.password);
    return r;
  }

  readonly port: number;
  readonly host: string;
  closed = false;
  private sock: net.Socket | undefined;
  private pending = Buffer.alloc(0);
  private readonly chunks = new Map<number, string[]>();
  private readonly onFirst = new Map<number, () => void>();
  private readonly onDone = new Map<number, (err: Error | null) => void>();
  private nextId = 2;
  private queue: Promise<void> = Promise.resolve();

  constructor(port: number, host: string) {
    this.port = port;
    this.host = host;
  }

  private open(password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.port, this.host);
      this.sock = sock;
      sock.once('error', (e) => reject(new Error(`can't reach the server's RCON on ${this.host}:${this.port} (${(e as NodeJS.ErrnoException).code}); is the server running?`)));
      sock.on('close', () => {
        this.closed = true;
        for (const fail of this.onDone.values()) fail(new Error('the server closed the RCON connection'));
        this.onDone.clear();
      });
      sock.on('data', (d: Buffer) => this.read(d));
      sock.once('connect', () => {
        this.onFirst.set(1, () => resolve());
        this.onFirst.set(-1, () => reject(new Error('the server rejected the RCON password')));
        sock.write(packet(1, AUTH, password));
      });
    });
  }

  private read(d: Buffer): void {
    this.pending = Buffer.concat([this.pending, d]);
    while (this.pending.length >= 4 && this.pending.length >= 4 + this.pending.readInt32LE(0)) {
      const len = this.pending.readInt32LE(0);
      const id = this.pending.readInt32LE(4);
      const body = this.pending.subarray(12, 4 + len - 2).toString('utf8');
      this.pending = this.pending.subarray(4 + len);
      const done = this.onDone.get(id);
      if (done) { this.onDone.delete(id); done(null); continue; }
      let chunks = this.chunks.get(id);
      if (!chunks) this.chunks.set(id, chunks = []);
      chunks.push(body);
      const first = this.onFirst.get(id);
      if (first) { this.onFirst.delete(id); first(); }
    }
  }

  /** Runs one command and resolves with its whole reply. Calls are queued, so replies never interleave. */
  send(cmd: string): Promise<string> {
    const run = () => new Promise<string>((resolve, reject) => {
      const sock = this.sock;
      if (this.closed || !sock) { reject(new Error('the RCON connection is closed')); return; }
      const id = this.nextId++;
      const marker = 1_000_000 + id;
      this.onDone.set(marker, (err) => {
        const body = (this.chunks.get(id) || []).join('');
        this.chunks.delete(id);
        if (err) reject(err); else resolve(body);
      });
      this.onFirst.set(id, () => sock.write(packet(marker, MARKER_TYPE, '')));
      sock.write(packet(id, COMMAND, cmd.replace(/^\//, '')));
    });
    const p = this.queue.then(run, run);
    this.queue = p.then(() => {}, () => {}); // the next command waits for this one either way; its caller sees the error
    return p;
  }

  close(): void { if (this.sock) this.sock.end(); }
}
