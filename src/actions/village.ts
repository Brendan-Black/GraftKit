// A village: varied houses in a ring with their doors toward the middle, dirt paths, a bell, villagers and optional
// iron golems. Beds, job blocks and the bell make the game treat it as a village, so raids work there.
import { checkTarget, withRcon, target, rng, runAll, type Direction, type Opts, type Rng } from './util.ts';
import { houseCommands, JOBS, type HouseInfo } from './house.ts';
import type { Context } from '../context.ts';
import { intIn } from '../values.ts';

/** The cardinal side of a house at (hx, hz) that faces the point (x, z). */
export function sideToward(hx: number, hz: number, x: number, z: number): Direction {
  const vx = x - hx, vz = z - hz;
  return Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 'east' : 'west') : (vz > 0 ? 'south' : 'north');
}

export interface VillageOptions { houses?: unknown; radius?: unknown; villagers?: unknown; golems?: unknown; style?: unknown; [other: string]: unknown }

/** Commands for a village centred on (X, Y, Z). Returns { commands, houses, radius }. */
export function villageCommands({ x: X, y: Y, z: Z }: { x: number; y: number; z: number }, R: Rng, opts: VillageOptions = {}): { commands: string[]; houses: HouseInfo[]; radius: number; villagers: number; golems: number } {
  const n = intIn(opts.houses ?? 6, 1, 16, '--houses');
  const radius = intIn(opts.radius ?? Math.max(13, Math.round(n * 2.6)), 8, 64, '--radius');
  const perHouse = intIn(opts.villagers ?? 1, 0, 4, '--villagers');
  const golems = intIn(opts.golems ?? 0, 0, 8, '--golems');
  const commands: string[] = [], houses: HouseInfo[] = [];
  const start = R.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = start + (Math.PI * 2 * i) / n;
    const hx = X + Math.round(radius * Math.cos(a)), hz = Z + Math.round(radius * Math.sin(a));
    const door = sideToward(hx, hz, X, Z);
    const { commands: hc, info } = houseCommands({ x: hx, y: Y, z: hz }, door, R, { style: opts.style, job: JOBS[i % JOBS.length] });
    commands.push(...hc);
    houses.push(info);
    // A dirt path from the doorstep to the middle, over grass and dirt only, clearing snow layers on it.
    const [dx, dz] = { east: [info.x1 + 1, info.cz], west: [info.x0 - 1, info.cz], south: [info.cx, info.z1 + 1], north: [info.cx, info.z0 - 1] }[door];
    for (const [ax, az, bx, bz] of [[dx, dz, X, dz], [X, dz, X, Z]]) {
      const box = `${Math.min(ax, bx)} ${Y - 1} ${Math.min(az, bz)} ${Math.max(ax, bx)} ${Y - 1} ${Math.max(az, bz)}`;
      commands.push(`fill ${box} dirt_path replace grass_block`, `fill ${box} dirt_path replace dirt`,
        `fill ${Math.min(ax, bx)} ${Y} ${Math.min(az, bz)} ${Math.max(ax, bx)} ${Y} ${Math.max(az, bz)} air replace snow`);
    }
  }
  // The bell, a step from the middle so it isn't on whoever stands there.
  commands.push(`setblock ${X + 2} ${Y - 1} ${Z} stone_bricks`, `setblock ${X + 2} ${Y} ${Z} bell[attachment=floor]`);
  for (const h of houses) for (let k = 0; k < perHouse; k++) commands.push(`summon villager ${h.cx + 0.5} ${h.y} ${h.cz + 0.5}`);
  for (let g = 0; g < golems; g++) commands.push(`summon iron_golem ${X + R.int(-4, 4) + 0.5} ${Y} ${Z + R.int(-4, 4) + 0.5} {PlayerCreated:1b}`);
  return { commands, houses, radius, villagers: houses.length * perHouse, golems };
}

/** graftkit village [--near p | --at x,y,z] [--houses 6] [--radius n] [--style ...] [--villagers 1] [--golems 0] [--seed n] */
export async function village(ctx: Context, opts: Opts): Promise<string[]> {
  checkTarget(opts);
  villageCommands({ x: 0, y: 0, z: 0 }, rng(0), opts); // checks the counts and style before anything touches the server
  return withRcon(ctx, async (r) => {
    const at = await target(r, opts);
    const R = rng(opts.seed !== undefined ? intIn(opts.seed, 0, 2 ** 31, '--seed') : undefined);
    const centre = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
    const v = villageCommands(centre, R, opts);
    const res = await runAll(r, v.commands);
    const styles = [...new Set(v.houses.map((h) => h.style))].join(', ');
    return [`village: ${v.houses.length} houses (${styles}) around ${centre.x} ${centre.y} ${centre.z}, radius ${v.radius}, ${v.villagers} villagers` +
      `${v.golems ? `, ${v.golems} golems` : ''}, bell at ${centre.x + 2} ${centre.y} ${centre.z} (seed ${R.seed})`,
      ...res.problems.map((p) => `  problem: ${p}`)];
  });
}
