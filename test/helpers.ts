// Test fixtures: jars built in memory, a throwaway server folder, and a pseudo RCON server that behaves like the
// vanilla one where it matters (one packet handled per read, long replies split into 4096-byte packets).
import fs from 'node:fs';
import os from 'node:os';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import type { TestContext } from 'node:test';
import { loadConfig, type Config } from '../src/config.ts';
import { createContext, type Context } from '../src/context.ts';
import { Rcon, packet } from '../src/rcon.ts';

/** A zip (jar) with the given { name: text } entries, stored uncompressed. */
export function makeJar(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text, 'utf8'), nameBuf = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(entries).length, 8); eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export const graftMod = (id: string, version: string): Buffer => makeJar({ 'graft.mod.properties': `id=${id}\nname=${id} mod\nversion=${version}\n`, 'a/B.class': 'x' });

/** A throwaway server folder with server.properties (RCON on), usercache.json and graft.jar. */
export function tempServer(t: TestContext, { rconPort = 0, password = 'pw' } = {}): { dir: string; cfg: Config } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graftkit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'server.properties'), `server-port=1\nenable-rcon=true\nrcon.port=${rconPort}\nrcon.password=${password}\n`);
  fs.writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([
    { name: 'Steve_Miner', uuid: 'fedcba98-7654-4321-8fed-cba987654321' },
    { name: 'Alex_Builder', uuid: '12345678-9abc-4def-8123-456789abcdef' },
  ]));
  fs.writeFileSync(path.join(dir, 'graft.jar'), makeJar({ 'META-INF/MANIFEST.MF': 'Main-Class: x\n' }));
  fs.mkdirSync(path.join(dir, 'mods'));
  const configFile = path.join(dir, 'graftkit.json');
  fs.writeFileSync(configFile, JSON.stringify({ serverDir: dir, modRoots: [], minecraft: '26.3', sharePort: 0, profileName: 'Graft (26.3)' }));
  return { dir, cfg: loadConfig({ file: configFile }) };
}

/**
 * A pseudo RCON server. handle(cmd) returns the reply text. Records every command. Like the vanilla server, it
 * handles only the first packet of each read and drops the rest.
 */
export async function pseudoRcon(t: TestContext, handle: (cmd: string) => string | null | undefined, { password = 'pw' } = {}): Promise<{ port: number; commands: string[]; server: net.Server }> {
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {}); // a test that drops the connection on purpose; the client side is what's tested
    sock.on('data', (d: Buffer) => {
      if (d.length < 14) return;
      const id = d.readInt32LE(4), type = d.readInt32LE(8);
      const body = d.subarray(12, 4 + d.readInt32LE(0) - 2).toString('utf8');
      if (type === 3) { sock.write(packet(body === password ? id : -1, 2, '')); return; }
      if (type !== 2) { sock.write(packet(id, 0, `Unknown request ${type.toString(16)}`)); return; }
      commands.push(body);
      const reply = String(handle(body) ?? '');
      if (!reply) { sock.write(packet(id, 0, '')); return; }
      for (let i = 0; i < reply.length; i += 4096) sock.write(packet(id, 0, reply.slice(i, i + 4096)));
    });
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  t.after(() => new Promise<void>((res) => { for (const s of sockets) s.destroy(); server.close(() => res()); }));
  return { port: portOf(server), commands, server };
}

/** A context whose RCON goes to a pseudo server, with a clock and sleep the test controls. */
export function testContext(cfg: Config, rconPort: number, { password = 'pw' } = {}): Context {
  let now = 0;
  return createContext(cfg, {
    connect: () => Rcon.connect({ port: rconPort, password }),
    clock: { now: () => now, wall: () => 1_700_000_000_000 },
    sleep: async (ms: number) => { now += ms; },
  });
}

/** A small pretend world for action tests: players at fixed spots, everything else succeeds. */
export function pretendWorld(players: Record<string, [x: number, y: number, z: number, yaw: number]> = { Alex_Builder: [-660.4, 70, 108.9, 0] }): { handle: (cmd: string) => string; summoned: string[] } {
  const summoned: string[] = [];
  const handle = (cmd: string) => {
    if (cmd === 'list') return `There are ${Object.keys(players).length} of a max of 10 players online: ${Object.keys(players).join(', ')}`;
    let m = cmd.match(/^data get entity (\w+) Pos$/);
    if (m) return players[m[1]] ? `${m[1]} has the following entity data: [${players[m[1]][0]}d, ${players[m[1]][1]}d, ${players[m[1]][2]}d]` : 'No entity was found';
    m = cmd.match(/^data get entity (\w+) Rotation$/);
    if (m) return players[m[1]] ? `${m[1]} has the following entity data: [${players[m[1]][3]}f, 0.0f]` : 'No entity was found';
    if (/^data get entity \w+ playerGameType$/.test(cmd)) return 'x has the following entity data: 0';
    if (cmd === 'tick query') return 'The game is running normally. Average time per tick: 3.2ms';
    if (/^execute at \w+ run summon /.test(cmd) || /^summon /.test(cmd)) { summoned.push(cmd); return `Summoned new ${cmd.includes(' cat ') ? 'Cat' : 'Wolf'}`; }
    m = cmd.match(/^execute if entity @e\[tag=(\w+)\]$/);
    if (m) { const n = summoned.filter((c) => c.includes(`"${m[1]}"`)).length; return n ? `Test passed. Count: ${n}` : 'Test failed'; }
    if (/^execute if entity/.test(cmd)) return 'Test failed';
    if (/^execute at \w+ if entity/.test(cmd)) return 'Test failed';
    if (/^(fill|setblock) /.test(cmd)) return /fill/.test(cmd) ? 'Successfully filled 9 block(s)' : 'Changed the block at 0, 0, 0';
    if (/^gamerule /.test(cmd)) return 'Game rule is now set';
    if (/^kill /.test(cmd)) return 'Killed 3 entities';
    if (/^(effect|give|item|title|playsound|particle|tp |execute at \w+ run (spreadplayers|particle|playsound))/.test(cmd)) return 'Applied effect';
    return `Unknown or incomplete command, see below for error${cmd}<--[HERE]`;
  };
  return { handle, summoned };
}

/** The port a listening server got. */
export function portOf(server: net.Server): number {
  return (server.address() as AddressInfo).port;
}
