// Shared by the actions: option parsing, where a target is, randomness, and turning many command replies into a
// short summary. Actions get a context { cfg, connect(), clock: { now() }, sleep(ms) } so tests can swap any of it.
import type { Context } from '../context.ts';
import type { Rcon } from '../rcon.ts';
import { playerName } from '../values.ts';

/** One option's value: text from the command line, or true for a bare flag. Code calling actions may pass numbers. */
export type OptValue = string | number | boolean;

/** Parsed options: positionals in _, the rest by name. Values are unchecked; each action checks what it takes. */
export interface Opts {
  _: string[];
  [name: string]: OptValue | string[] | undefined;
}

/** An action: what `graftkit <action>` and the dashboard's toolkit run. Resolves with lines to show. */
export type Action = (ctx: Context, opts: Opts) => Promise<string[]>;

/** ["house", "--near", "bob", "--fast"] -> { _: ["house"], near: "bob", fast: true } */
export function parseArgs(argv: readonly string[]): Opts {
  const out: Opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

/** Checks the targeting options before anything touches the server. */
export function checkTarget(opts: Opts): Opts {
  for (const k of ['near', 'for', 'player']) if (opts[k] !== undefined) playerName(opts[k]);
  return opts;
}

export async function withRcon<T>(ctx: Context, fn: (r: Rcon) => Promise<T>): Promise<T> {
  const r = await ctx.connect();
  try { return await fn(r); } finally { r.close(); }
}

const num = (s: string) => Number(String(s).replace(/[dfbsL]$/, ''));

/** Where a player (or a spot given with --at) is, and which way they face. */
export interface Position { x: number; y: number; z: number; yaw: number; player: string | null }

/** A player's position and facing, or null when they aren't online. */
export async function playerAt(r: Rcon, name: string): Promise<Position | null> {
  const pos = await r.send(`data get entity ${playerName(name)} Pos`);
  const m = pos.match(/\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/);
  if (!m) return null;
  const rm = (await r.send(`data get entity ${name} Rotation`)).match(/\[(-?[\d.E-]+)f, (-?[\d.E-]+)f\]/);
  return { x: num(m[1]), y: num(m[2]), z: num(m[3]), yaw: rm ? num(rm[1]) : 0, player: name };
}

export async function online(r: Rcon): Promise<string[]> {
  const list = await r.send('list');
  return (list.split(':')[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** --at x,y,z, or --near/--for/--player <name>, or else the only player online. */
export async function target(r: Rcon, opts: Partial<Opts>): Promise<Position> {
  if (opts.at) {
    const [x, y, z] = String(opts.at).split(',').map(Number);
    if ([x, y, z].some((v) => !Number.isFinite(v))) throw new Error('--at needs x,y,z');
    return { x, y, z, yaw: Number(opts.yaw || 0), player: null };
  }
  let name = opts.near || opts.for || opts.player;
  if (!name) {
    const names = await online(r);
    if (names.length !== 1) throw new Error(names.length ? `${names.length} players are online; say which with --near <name>` : 'nobody is online; name a player or use --at x,y,z');
    name = names[0];
  }
  const at = await playerAt(r, playerName(name));
  if (!at) throw new Error(`${name} isn't online`);
  return at;
}

export type Direction = 'north' | 'south' | 'east' | 'west';

/** Minecraft yaw -> the cardinal direction faced (0 = south, 90 = west). */
export function facing(yaw: number): Direction {
  const y = ((yaw % 360) + 360) % 360;
  if (y >= 45 && y < 135) return 'west';
  if (y >= 135 && y < 225) return 'north';
  if (y >= 225 && y < 315) return 'east';
  return 'south';
}
export const STEP: Record<Direction, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
export const OPPOSITE: Record<Direction, Direction> = { north: 'south', south: 'north', east: 'west', west: 'east' };
export const DIRECTIONS = Object.keys(STEP) as Direction[];

export interface Rng {
  seed: number;
  next(): number;
  int(a: number, b: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}

/** Seeded randomness, so a --seed rebuilds exactly the same thing. */
export function rng(seed = Math.floor(Math.random() * 2 ** 31)): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { seed, next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
}

// Replies that mean the command did what was asked (or that there was nothing to do).
const FINE = /^(Successfully filled|Changed the block|Summoned new|No blocks were filled|Could not set the block|Applied effect|Gave |Replaced |Teleported|Spread |Removed |Killed |Modified entity|Displaying particle|Played sound|Showing new|Set |Game rule|Marked|Unmarked|Test passed|Test failed|There are|Unable to apply this effect|$)/;

/** Runs commands; returns { ok, problems: [unique error lines with counts] }. */
export async function runAll(r: Rcon, commands: readonly string[], { delay = 0, sleep }: { delay?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ ok: number; problems: string[] }> {
  const problems = new Map<string, number>();
  let ok = 0;
  for (const c of commands) {
    const out = await r.send(c);
    const bad = out.split(/(?<=[a-z.!)\]])(?=[A-Z])/).filter((l) => l && !FINE.test(l));
    if (bad.length) { const k = bad[0].slice(0, 140); problems.set(k, (problems.get(k) || 0) + 1); } else ok++;
    if (delay && sleep) await sleep(delay);
  }
  return { ok, problems: [...problems].map(([k, n]) => (n > 1 ? `${k} (x${n})` : k)) };
}

export const countOf = (out: string): number => { const m = out.match(/Count: (\d+)/); return m ? Number(m[1]) : 0; };
