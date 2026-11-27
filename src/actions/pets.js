// Tamed pets: an army of cats and dogs (adults and babies; every coat, collar and voice) launched in a fountain, and
// housekeeping for a player's pets: count, gather, immortal, babies, grow, sit, stand, kill. Commands reach only pets
// in loaded parts of the world.
const { uuidOf, uuidIntArray } = require('../players');
const { playerName, intIn } = require('../values');
const { withRcon, target, rng, runAll, countOf } = require('./util');

const CAT_COATS = ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie', 'all_black'];
const DOG_COATS = ['ashen', 'black', 'chestnut', 'pale', 'rusty', 'snowy', 'spotted', 'striped', 'woods'];
const CAT_VOICES = ['classic', 'royal'];
const DOG_VOICES = ['angry', 'big', 'classic', 'cute', 'grumpy', 'puglin', 'sad'];
const MOB = { cat: 'cat', dog: 'wolf', wolf: 'wolf' };

const ownerNbt = (ctx, player) => `Owner:${uuidIntArray(uuidOf(ctx.cfg.serverDir, player).uuid)}`;
const killed = (out) => Number((out.match(/Killed (\d+)/) || [0, 0])[1]);

/** The pets to make, coats spread evenly per kind, in a shuffled order. */
function armyList(counts, R) {
  const list = [];
  let i = 0;
  for (const [type, adults, babies] of [['cat', counts.cats, counts.kittens], ['wolf', counts.dogs, counts.puppies]]) {
    const coats = type === 'cat' ? CAT_COATS : DOG_COATS, voices = type === 'cat' ? CAT_VOICES : DOG_VOICES;
    for (const [n, baby] of [[adults, false], [babies, true]]) for (let k = 0; k < n; k++) list.push({ type, baby, coat: coats[i++ % coats.length], voice: R.pick(voices) });
  }
  for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(R.next() * (k + 1)); [list[k], list[j]] = [list[j], list[k]]; }
  return list;
}

function summonCommand(player, owner, p, tag, immortal, R) {
  const mx = (R.next() * 0.7 - 0.35).toFixed(3), mz = (R.next() * 0.7 - 0.35).toFixed(3), my = (0.8 + R.next() * 0.3).toFixed(3);
  return `execute at ${player} run summon ${p.type} ~ ~2.5 ~ {${owner},Tags:["${tag}","graftkit_pet"]${immortal ? ',Invulnerable:1b' : ''},` +
    `variant:"minecraft:${p.coat}",sound_variant:"minecraft:${p.voice}",CollarColor:${R.int(0, 15)}b${p.baby ? ',Age:-24000,AgeLocked:1b' : ''},Motion:[${mx}d,${my}d,${mz}d]}`;
}

/** graftkit army --for p [--cats 100 --kittens 100 --dogs 100 --puppies 100] [--interval 50] [--replace] [--mortal] [--no-show] [--seed n] */
async function army(ctx, opts) {
  const player = playerName(opts.for || opts.player || opts.near);
  const owner = ownerNbt(ctx, player);
  const counts = {};
  for (const k of ['cats', 'kittens', 'dogs', 'puppies']) counts[k] = intIn(opts[k] ?? 100, 0, 500, `--${k}`);
  const interval = intIn(opts.interval ?? 50, 0, 2000, '--interval');
  const R = rng(opts.seed !== undefined ? intIn(opts.seed, 0, 2 ** 31, '--seed') : undefined);
  const list = armyList(counts, R);
  const tag = `army_${ctx.clock.wall().toString(36)}`;
  const immortal = !opts.mortal, show = !opts['no-show'];

  return withRcon(ctx, async (r) => {
    await target(r, { player }); // fails early when they aren't online
    let removed = 0;
    if (opts.replace) {
      await r.send('gamerule show_death_messages false');
      try { removed = killed(await r.send(`kill @e[nbt={${owner}}]`)); } finally { await r.send('gamerule show_death_messages true'); }
    }
    await r.send('gamerule max_entity_cramming 0'); // hundreds of pets in one spot would otherwise crush each other
    if (show) await r.send(`execute at ${player} run playsound minecraft:block.beacon.activate master @a ~ ~ ~ 1 1.2`);
    const cmds = [];
    list.forEach((p, n) => {
      cmds.push(summonCommand(player, owner, p, tag, immortal, R));
      if (show && n % 4 === 3) cmds.push(`execute at ${player} run particle minecraft:firework ~ ~3 ~ 0.4 0.4 0.4 0.15 25 force`);
    });
    const res = await runAll(r, cmds, { delay: interval, sleep: ctx.sleep });
    const made = countOf(await r.send(`execute if entity @e[tag=${tag}]`));
    return [`army: ${made} of ${list.length} pets for ${player} (${counts.cats} cats, ${counts.kittens} kittens, ${counts.dogs} dogs, ${counts.puppies} puppies)` +
      `${immortal ? ', immortal' : ''}, babies stay small, tag ${tag}${opts.replace ? `, replaced ${removed} old pets` : ''}`,
      ...res.problems.map((p) => `  problem: ${p}`)];
  });
}

const PET_ACTIONS = {
  immortal: ['{Invulnerable:1b}', 'made immortal'],
  mortal: ['{Invulnerable:0b}', 'made mortal'],
  babies: ['{Age:-24000,AgeLocked:1b}', 'turned into babies that stay small'],
  grow: ['{Age:0,AgeLocked:0b}', 'grown up'],
  sit: ['{Sitting:1b}', 'sitting'],
  stand: ['{Sitting:0b}', 'standing'],
};

/** graftkit pets <count|gather|kill|immortal|mortal|babies|grow|sit|stand> --for p [--type cat|dog] [--radius 12] [--keep <tag>] */
async function pets(ctx, opts) {
  const sub = opts._[1] || 'count';
  const player = playerName(opts.for || opts.player || opts.near);
  const owner = ownerNbt(ctx, player);
  if (opts.type && !MOB[opts.type]) throw new Error('--type is cat or dog');
  const type = opts.type ? `type=${MOB[opts.type]},` : '';
  const sel = `@e[${type}nbt={${owner}}]`;
  return withRcon(ctx, async (r) => {
    const n = async () => countOf(await r.send(`execute if entity ${sel}`));
    if (sub === 'count') {
      const cats = countOf(await r.send(`execute if entity @e[type=cat,nbt={${owner}}]`));
      const dogs = countOf(await r.send(`execute if entity @e[type=wolf,nbt={${owner}}]`));
      const near = countOf(await r.send(`execute at ${player} if entity @e[nbt={${owner}},distance=..32]`));
      return [`pets of ${player}: ${cats} cats and ${dogs} dogs loaded, ${near} within 32 blocks of them (pets in unloaded areas aren't counted)`];
    }
    if (PET_ACTIONS[sub]) {
      const total = await n();
      await r.send(`execute as ${sel} run data merge entity @s ${PET_ACTIONS[sub][0]}`);
      return [`${total} pets of ${player} ${PET_ACTIONS[sub][1]}`];
    }
    if (sub === 'gather') {
      const total = await n();
      const radius = intIn(opts.radius ?? 12, 2, 64, '--radius');
      await runAll(r, [`tp ${sel} ${player}`, `execute at ${player} run spreadplayers ~ ~ 1 ${radius} false ${sel}`,
        `execute at ${player} run particle minecraft:heart ~ ~1 ~ 6 1 6 0 60 force`]);
      return [`gathered ${total} pets around ${player} (only pets in loaded areas can be reached)`];
    }
    if (sub === 'kill') {
      if (opts.keep && !/^[\w.-]{1,64}$/.test(opts.keep)) throw new Error('--keep takes a tag name');
      await r.send('gamerule show_death_messages false');
      let out;
      try { out = await r.send(`kill @e[${type}nbt={${owner}}${opts.keep ? `,tag=!${opts.keep}` : ''}]`); } finally { await r.send('gamerule show_death_messages true'); }
      return [`removed ${killed(out)} pets of ${player}${opts.keep ? ` (kept those tagged ${opts.keep})` : ''}`];
    }
    throw new Error(`unknown pets action "${sub}"; try count, gather, kill, ${Object.keys(PET_ACTIONS).join(', ')}`);
  });
}

module.exports = { army, pets, armyList, CAT_COATS, DOG_COATS };
