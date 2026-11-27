// RCON client. Long replies arrive as several packets with one id; after a command's first reply packet we send a
// marker packet of an unknown type, which the server answers only after the whole reply. The vanilla server handles
// one packet per read, so the marker is never sent together with the command.
const net = require('net');
const { readProps } = require('./config');

const AUTH = 3, COMMAND = 2, MARKER_TYPE = 99;

function packet(id, type, body) {
  const payload = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + payload.length);
  buf.writeInt32LE(10 + payload.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  payload.copy(buf, 12);
  return buf;
}

/** The RCON port and password from a server's server.properties. */
function rconSettings(serverDir) {
  const props = readProps(serverDir);
  if (props['enable-rcon'] !== 'true' || !props['rcon.password']) throw new Error(`RCON isn't enabled in ${serverDir}\\server.properties`);
  return { port: Number(props['rcon.port'] || 25575), password: props['rcon.password'] };
}

class Rcon {
  /** Connects and logs in. settings: { port, password, host? } */
  static async connect(settings) {
    const r = new Rcon(settings.port, settings.host || '127.0.0.1');
    await r.open(settings.password);
    return r;
  }

  constructor(port, host) {
    this.port = port;
    this.host = host;
    this.pending = Buffer.alloc(0);
    this.chunks = new Map();
    this.onFirst = new Map();
    this.onDone = new Map();
    this.nextId = 2;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  open(password) {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.port, this.host);
      this.sock = sock;
      sock.once('error', (e) => reject(new Error(`can't reach the server's RCON on ${this.host}:${this.port} (${e.code}); is the server running?`)));
      sock.on('close', () => {
        this.closed = true;
        for (const fail of this.onDone.values()) fail(new Error('the server closed the RCON connection'));
        this.onDone.clear();
      });
      sock.on('data', (d) => this.read(d));
      sock.once('connect', () => {
        this.onFirst.set(1, () => resolve());
        this.onFirst.set(-1, () => reject(new Error('the server rejected the RCON password')));
        sock.write(packet(1, AUTH, password));
      });
    });
  }

  read(d) {
    this.pending = Buffer.concat([this.pending, d]);
    while (this.pending.length >= 4 && this.pending.length >= 4 + this.pending.readInt32LE(0)) {
      const len = this.pending.readInt32LE(0);
      const id = this.pending.readInt32LE(4);
      const body = this.pending.subarray(12, 4 + len - 2).toString('utf8');
      this.pending = this.pending.subarray(4 + len);
      if (this.onDone.has(id)) { const done = this.onDone.get(id); this.onDone.delete(id); done(null); continue; }
      if (!this.chunks.has(id)) this.chunks.set(id, []);
      this.chunks.get(id).push(body);
      if (this.onFirst.has(id)) { const first = this.onFirst.get(id); this.onFirst.delete(id); first(); }
    }
  }

  /** Runs one command and resolves with its whole reply. Calls are queued, so replies never interleave. */
  send(cmd) {
    const run = () => new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('the RCON connection is closed')); return; }
      const id = this.nextId++;
      const marker = 1_000_000 + id;
      this.onDone.set(marker, (err) => {
        const body = (this.chunks.get(id) || []).join('');
        this.chunks.delete(id);
        if (err) reject(err); else resolve(body);
      });
      this.onFirst.set(id, () => this.sock.write(packet(marker, MARKER_TYPE, '')));
      this.sock.write(packet(id, COMMAND, cmd.replace(/^\//, '')));
    });
    const p = this.queue.then(run, run);
    this.queue = p.then(() => {}, () => {}); // the next command waits for this one either way; its caller sees the error
    return p;
  }

  close() { if (this.sock) this.sock.end(); }
}

module.exports = { Rcon, rconSettings, packet };
