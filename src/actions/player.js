// Player actions: status, immortality buffs, full gear, a raid, an on-screen title, and raw commands.
const { withRcon, playerAt, online, runAll, countOf } = require('./util');
const { playerName, playerOrSelector, intIn } = require('../values');

const MODES = ['survival', 'creative', 'adventure', 'spectator'];

/** graftkit status */
async function status(ctx) {
  return withRcon(ctx, async (r) => {
    const names = await online(r);
    const lines = [`${names.length} player(s) online${names.length ? ':' : ''}`];
    for (const n of names) {
      const at = await playerAt(r, n);
      const mode = (await r.send(`data get entity ${n} playerGameType`)).match(/: (\d)/);
      lines.push(`  ${n} at ${at ? `${Math.floor(at.x)} ${Math.floor(at.y)} ${Math.floor(at.z)}` : 'unknown'} (${mode ? MODES[Number(mode[1])] : 'unknown mode'})`);
    }
    const ms = (await r.send('tick query')).match(/([\d.]+)\s*ms/);
    lines.push(ms ? `  server tick: ${ms[1]} ms (the budget is 50; more means lag)` : '  server tick: unknown');
    return lines;
  });
}

const BUFFS = [['resistance', 4], ['fire_resistance', 0], ['saturation', 0], ['regeneration', 1], ['water_breathing', 0]];

/** graftkit immortal --for p [--off] */
async function immortal(ctx, opts) {
  const p = playerName(opts.for || opts.player);
  return withRcon(ctx, async (r) => {
    if (opts.off) { await r.send(`effect clear ${p}`); return [`${p}: every effect cleared`]; }
    const res = await runAll(r, BUFFS.map(([e, lvl]) => `effect give ${p} ${e} infinite ${lvl} true`));
    return [`${p}: Resistance V, Fire Resistance, Saturation, Regeneration II and Water Breathing, permanent (the void and /kill still kill)`,
      ...res.problems.map((x) => `  problem: ${x}`)];
  });
}

const ARMOR = {
  head: 'netherite_helmet[enchantments={protection:4,unbreaking:3,mending:1,respiration:3,aqua_affinity:1}]',
  chest: 'netherite_chestplate[enchantments={protection:4,unbreaking:3,mending:1}]',
  legs: 'netherite_leggings[enchantments={protection:4,unbreaking:3,mending:1,swift_sneak:3}]',
  feet: 'netherite_boots[enchantments={protection:4,unbreaking:3,mending:1,feather_falling:4,depth_strider:3,soul_speed:3}]',
};
const SWORD_ENCHANTMENTS = '{sharpness:5,unbreaking:3,looting:3,fire_aspect:2,sweeping_edge:3,mending:1}';

/** graftkit gear --for p [--elytra] [--sword truezoom:thunderfury] [--rockets n] */
async function gear(ctx, opts) {
  const p = playerName(opts.for || opts.player);
  const sword = String(opts.sword || 'truezoom:thunderfury');
  if (!/^[a-z0-9_.-]+:[a-z0-9_/.-]+$|^[a-z0-9_/.-]+$/.test(sword)) throw new Error(`"${sword}" isn't an item id`);
  const rockets = opts.elytra || opts.rockets ? intIn(opts.rockets ?? 64, 1, 2304, '--rockets') : 0;
  return withRcon(ctx, async (r) => {
    const cmds = [`item replace entity ${p} armor.head with ${ARMOR.head}`, `item replace entity ${p} armor.legs with ${ARMOR.legs}`, `item replace entity ${p} armor.feet with ${ARMOR.feet}`];
    if (opts.elytra) cmds.push(`item replace entity ${p} armor.chest with elytra[enchantments={unbreaking:3,mending:1}]`, `give ${p} ${ARMOR.chest}`);
    else cmds.push(`item replace entity ${p} armor.chest with ${ARMOR.chest}`);
    cmds.push(`give ${p} ${sword}[enchantments=${SWORD_ENCHANTMENTS}]`);
    if (rockets) cmds.push(`give ${p} firework_rocket ${rockets}`);
    const res = await runAll(r, cmds);
    return [`${p}: enchanted netherite armor${opts.elytra ? ' (elytra worn, chestplate in the inventory)' : ''}, ${sword}${rockets ? `, ${rockets} rockets` : ''}`,
      ...res.problems.map((x) => `  problem: ${x}`)];
  });
}

/** graftkit raid --for p  (they must be standing in a village). Waits up to 75 s for the first wave. */
async function raid(ctx, opts) {
  const p = playerName(opts.for || opts.player);
  return withRcon(ctx, async (r) => {
    await r.send(`effect give ${p} bad_omen 6000 0`);
    const deadline = ctx.clock.now() + 75_000;
    let omen = false;
    while (ctx.clock.now() < deadline) {
      if (/passed/.test(await r.send(`execute if entity @a[name=${p},nbt={active_effects:[{id:"minecraft:raid_omen"}]}]`))) omen = true;
      const n = countOf(await r.send(`execute at ${p} if entity @e[type=#minecraft:raiders,distance=..120]`));
      if (omen && n >= 3) return [`raid started on ${p}: ${n} raiders in the first wave`];
      await ctx.sleep(3000);
    }
    return [omen ? `${p} has the raid omen, but no raiders came within 75 s; it may still start` :
      `no raid: ${p} has Bad Omen but isn't in a village (it needs beds, job blocks or a bell nearby; try graftkit village first)`];
  });
}

/** graftkit title --for p "Big text" ["small text"] */
async function title(ctx, opts) {
  const p = playerOrSelector(opts.for || opts.player || '@a');
  const [big = '', small = ''] = opts._.slice(1);
  const component = (text, color, bold) => JSON.stringify({ text: String(text), color, ...(bold ? { bold: true } : {}) });
  return withRcon(ctx, async (r) => {
    const res = await runAll(r, [`title ${p} times 10 60 20`, ...(small ? [`title ${p} subtitle ${component(small, 'yellow')}`] : []), `title ${p} title ${component(big, 'gold', true)}`]);
    return [`title shown to ${p}`, ...res.problems.map((x) => `  problem: ${x}`)];
  });
}

/** graftkit cmd "<command>" ...  (raw server commands, as typed in the server console) */
async function cmd(ctx, opts) {
  const commands = opts._.slice(1);
  if (!commands.length) throw new Error('cmd needs at least one command');
  return withRcon(ctx, async (r) => {
    const out = [];
    for (const c of commands) {
      const reply = await r.send(c);
      out.push(`> ${c}`, reply.length > 1500 ? `${reply.slice(0, 1500)} ... (${reply.length} characters)` : reply || '(no output)');
    }
    return out;
  });
}

module.exports = { status, immortal, gear, raid, title, cmd };
