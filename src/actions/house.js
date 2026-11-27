// Houses with variation: size, one of nine material sets, gabled or flat roof, windows, bed, furniture, carpet,
// lantern and sometimes a chimney. Each house is axis-aligned with its door on one side, facing outward.
const { checkTarget, withRcon, target, facing, STEP, OPPOSITE, rng, runAll } = require('./util');
const { intIn } = require('../values');

const STYLES = {
  spruce:    { wall: 'spruce_planks', frame: 'spruce_log', floor: 'spruce_planks', roof: 'spruce', door: 'spruce' },
  oak:       { wall: 'oak_planks', frame: 'oak_log', floor: 'oak_planks', roof: 'dark_oak', door: 'oak' },
  birch:     { wall: 'birch_planks', frame: 'stripped_birch_log', floor: 'birch_planks', roof: 'spruce', door: 'birch' },
  stone:     { wall: 'stone_bricks', frame: 'cobblestone', floor: 'spruce_planks', roof: 'stone_brick', door: 'spruce' },
  brick:     { wall: 'bricks', frame: 'stripped_spruce_log', floor: 'dark_oak_planks', roof: 'deepslate_tile', door: 'dark_oak' },
  sandstone: { wall: 'smooth_sandstone', frame: 'cut_sandstone', floor: 'birch_planks', roof: 'smooth_sandstone', door: 'birch' },
  cherry:    { wall: 'cherry_planks', frame: 'cherry_log', floor: 'cherry_planks', roof: 'cherry', door: 'cherry' },
  mangrove:  { wall: 'mangrove_planks', frame: 'mangrove_log', floor: 'mangrove_planks', roof: 'mangrove', door: 'mangrove' },
  deepslate: { wall: 'deepslate_bricks', frame: 'polished_deepslate', floor: 'dark_oak_planks', roof: 'deepslate_tile', door: 'dark_oak' },
};
const SIZES = { small: [5, 6, 3, 3], medium: [6, 8, 3, 4], large: [8, 10, 4, 5] }; // [min side, max side, min height, max height]
const ROOFS = ['gable', 'flat'];
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const GLASS = ['glass', 'glass', 'white_stained_glass', 'light_blue_stained_glass', 'brown_stained_glass'];
const JOBS = ['composter', 'lectern', 'smithing_table', 'fletching_table', 'brewing_stand', 'cartography_table', 'barrel', 'blast_furnace', 'smoker', 'loom', 'grindstone', 'stonecutter', 'cauldron'];

function choose(value, options, what) {
  if (value === undefined || value === true || value === 'random') return null;
  if (!options.includes(value)) throw new Error(`unknown ${what} "${value}"; try ${options.join(', ')}`);
  return value;
}

/**
 * Commands for one house. (x, y, z) is the centre of the footprint at floor level (the block a player stands in);
 * door is the wall the door goes in. Returns { commands, info }.
 */
function houseCommands({ x, y, z }, door, R, opts = {}) {
  const styleName = choose(opts.style, Object.keys(STYLES), 'style') || R.pick(Object.keys(STYLES));
  const S = STYLES[styleName];
  const sizeName = choose(opts.size, Object.keys(SIZES), 'size') || (R.chance(0.2) ? 'large' : R.chance(0.4) ? 'small' : 'medium');
  const [lo, hi, hlo, hhi] = SIZES[sizeName];
  const roofStyle = choose(opts.roof, ROOFS, 'roof') || (R.chance(0.75) ? 'gable' : 'flat');
  const w = R.int(lo, hi), d = R.int(lo, hi), h = R.int(hlo, hhi);
  const x0 = Math.round(x) - Math.floor(w / 2), z0 = Math.round(z) - Math.floor(d / 2), Y = Math.floor(y);
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  const cx = x0 + Math.floor(w / 2), cz = z0 + Math.floor(d / 2);
  const roofHeight = roofStyle === 'gable' ? Math.ceil(Math.min(w, d) / 2) + 1 : 1;
  const c = [];
  const fill = (ax, ay, az, bx, by, bz, block, mode) => c.push(`fill ${ax} ${ay} ${az} ${bx} ${by} ${bz} ${block}${mode ? ` ${mode}` : ''}`);
  const set = (ax, ay, az, block) => c.push(`setblock ${ax} ${ay} ${az} ${block}`);

  // Clear the plot (trees, snow, hills), then a foundation so the house doesn't float over dips or water.
  fill(x0 - 2, Y, z0 - 2, x1 + 2, Y + h + roofHeight + 2, z1 + 2, 'air');
  fill(x0, Y - 5, z0, x1, Y - 2, z1, 'cobblestone', 'replace air');
  fill(x0, Y - 5, z0, x1, Y - 2, z1, 'cobblestone', 'replace water');
  fill(x0, Y - 1, z0, x1, Y - 1, z1, S.floor);

  // Walls, corner posts, ceiling.
  fill(x0, Y, z0, x1, Y + h - 1, z0, S.wall); fill(x0, Y, z1, x1, Y + h - 1, z1, S.wall);
  fill(x0, Y, z0, x0, Y + h - 1, z1, S.wall); fill(x1, Y, z0, x1, Y + h - 1, z1, S.wall);
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) fill(px, Y - 1, pz, px, Y + h, pz, S.frame);
  fill(x0, Y + h, z0, x1, Y + h, z1, S.floor);

  // Roof: rows of stairs rising to a ridge along the longer side, with gable walls under it; or a slab lid.
  let roofTop = Y + h + 1;
  if (roofStyle === 'flat') {
    fill(x0 - 1, Y + h + 1, z0 - 1, x1 + 1, Y + h + 1, z1 + 1, `${S.roof}_slab`);
  } else if (w >= d) {
    let k = 0;
    for (; z0 - 1 + k < z1 + 1 - k; k++) {
      fill(x0 - 1, Y + h + k, z0 - 1 + k, x1 + 1, Y + h + k, z0 - 1 + k, `${S.roof}_stairs[facing=south]`);
      fill(x0 - 1, Y + h + k, z1 + 1 - k, x1 + 1, Y + h + k, z1 + 1 - k, `${S.roof}_stairs[facing=north]`);
      if (k > 0 && z0 + k <= z1 - k) { fill(x0, Y + h + k, z0 + k, x0, Y + h + k, z1 - k, S.wall); fill(x1, Y + h + k, z0 + k, x1, Y + h + k, z1 - k, S.wall); }
    }
    if (z0 - 1 + k === z1 + 1 - k) fill(x0 - 1, Y + h + k, z0 - 1 + k, x1 + 1, Y + h + k, z0 - 1 + k, `${S.roof}_slab`);
    roofTop = Y + h + k;
  } else {
    let k = 0;
    for (; x0 - 1 + k < x1 + 1 - k; k++) {
      fill(x0 - 1 + k, Y + h + k, z0 - 1, x0 - 1 + k, Y + h + k, z1 + 1, `${S.roof}_stairs[facing=east]`);
      fill(x1 + 1 - k, Y + h + k, z0 - 1, x1 + 1 - k, Y + h + k, z1 + 1, `${S.roof}_stairs[facing=west]`);
      if (k > 0 && x0 + k <= x1 - k) { fill(x0 + k, Y + h + k, z0, x1 - k, Y + h + k, z0, S.wall); fill(x0 + k, Y + h + k, z1, x1 - k, Y + h + k, z1, S.wall); }
    }
    if (x0 - 1 + k === x1 + 1 - k) fill(x0 - 1 + k, Y + h + k, z0 - 1, x0 - 1 + k, Y + h + k, z1 + 1, `${S.roof}_slab`);
    roofTop = Y + h + k;
  }

  // Windows on every wall, two high when the walls are tall.
  const glass = R.pick(GLASS);
  const top = h >= 4 ? Y + 2 : Y + 1;
  for (let wx = x0 + 2; wx <= x1 - 2; wx += 2) { fill(wx, Y + 1, z0, wx, top, z0, glass); fill(wx, Y + 1, z1, wx, top, z1, glass); }
  for (let wz = z0 + 2; wz <= z1 - 2; wz += 2) { fill(x0, Y + 1, wz, x0, top, wz, glass); fill(x1, Y + 1, wz, x1, top, wz, glass); }

  // The door (facing inward) and a doorstep.
  const [dx, dz] = { north: [cx, z0], south: [cx, z1], west: [x0, cz], east: [x1, cz] }[door];
  fill(dx, Y, dz, dx, Y + 1, dz, 'air');
  set(dx, Y, dz, `${S.door}_door[facing=${OPPOSITE[door]},half=lower,hinge=left]`);
  set(dx, Y + 1, dz, `${S.door}_door[facing=${OPPOSITE[door]},half=upper,hinge=left]`);
  const [sx, sz] = STEP[door];
  set(dx + sx, Y - 1, dz + sz, R.pick(['cobblestone', 'mossy_cobblestone', 'stone_bricks', 'polished_andesite']));

  // Furniture: the bed against the back wall, a job block or crafting table in the other back corner, storage by the door.
  const back = OPPOSITE[door];
  const bed = `${R.pick(COLORS)}_bed`;
  const corners = { // interior tiles: back-left, back-right, front-left, front-right
    north: [[x0 + 1, z1 - 1], [x1 - 1, z1 - 1], [x0 + 1, z0 + 1], [x1 - 1, z0 + 1]],
    south: [[x0 + 1, z0 + 1], [x1 - 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z1 - 1]],
    west: [[x1 - 1, z0 + 1], [x1 - 1, z1 - 1], [x0 + 1, z0 + 1], [x0 + 1, z1 - 1]],
    east: [[x0 + 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z0 + 1], [x1 - 1, z1 - 1]],
  }[door];
  const [bx, bz] = corners[0];
  const [ix, iz] = STEP[door]; // from the head at the back wall, the foot points toward the door
  set(bx, Y, bz, `${bed}[facing=${back},part=head]`);
  set(bx + ix, Y, bz + iz, `${bed}[facing=${back},part=foot]`);
  set(corners[1][0], Y, corners[1][1], opts.job || R.pick(['crafting_table', 'furnace', 'bookshelf', 'barrel', R.pick(JOBS)]));
  set(corners[2][0], Y, corners[2][1], R.pick(['chest', 'barrel', 'bookshelf']));
  set(corners[3][0], Y, corners[3][1], R.pick(['potted_poppy', 'potted_dandelion', 'potted_azure_bluet', 'potted_fern', 'potted_spruce_sapling', 'furnace', 'crafting_table']));
  if (R.chance(0.6)) fill(x0 + 1, Y, z0 + 1, x1 - 1, Y, z1 - 1, `${R.pick(COLORS)}_carpet`, 'replace air');
  set(cx, Y + h - 1, cz, 'lantern[hanging=true]');

  // Sometimes a chimney through the roof, topped with a smoking campfire.
  const chimney = R.chance(0.35);
  if (chimney) {
    const [chx, chz] = corners[1];
    fill(chx, Y + h + 1, chz, chx, roofTop + 1, chz, R.pick(['cobblestone', 'bricks', 'stone_bricks']));
    set(chx, roofTop + 2, chz, 'campfire[lit=true]');
  }

  return { commands: c, info: { style: styleName, size: sizeName, w, d, h, roof: roofStyle, door, chimney, x0, z0, x1, z1, y: Y, cx, cz, bed: [[bx, bz], [bx + ix, bz + iz]], doorAt: [dx, dz] } };
}

/** graftkit house [--near p | --at x,y,z] [--dist 10] [--style ...] [--size small|medium|large] [--roof gable|flat] [--seed n] */
async function house(ctx, opts) {
  checkTarget(opts);
  if (opts.style !== undefined) choose(opts.style, Object.keys(STYLES), 'style');
  if (opts.size !== undefined) choose(opts.size, Object.keys(SIZES), 'size');
  return withRcon(ctx, async (r) => {
    const at = await target(r, opts);
    const dir = opts.facing ? choose(opts.facing, Object.keys(STEP), 'facing') : facing(at.yaw);
    const dist = intIn(opts.dist ?? 10, 4, 64, '--dist');
    const [fx, fz] = STEP[dir];
    const R = rng(opts.seed !== undefined ? intIn(opts.seed, 0, 2 ** 31, '--seed') : undefined);
    const centre = { x: Math.floor(at.x) + fx * dist, y: Math.floor(at.y), z: Math.floor(at.z) + fz * dist };
    const { commands, info } = houseCommands(centre, OPPOSITE[dir], R, opts);
    const res = await runAll(r, commands);
    return [`house: ${info.style} ${info.size} ${info.w}x${info.d}, ${info.h} tall, ${info.roof} roof${info.chimney ? ', chimney' : ''}, door ${info.door}, at ${info.cx} ${info.y} ${info.cz} (seed ${R.seed})`,
      ...res.problems.map((p) => `  problem: ${p}`)];
  });
}

module.exports = { house, houseCommands, STYLES, SIZES, JOBS };
