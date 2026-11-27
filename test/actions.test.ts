import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { army, pets } from '../src/actions/pets.ts';
import { house } from '../src/actions/house.ts';
import { village } from '../src/actions/village.ts';
import * as player from '../src/actions/player.ts';
import { tempServer, pseudoRcon, testContext, pretendWorld } from './helpers.ts';

async function setup(t: TestContext, players?: Parameters<typeof pretendWorld>[0]) {
  const { cfg } = tempServer(t);
  const world = pretendWorld(players);
  const s = await pseudoRcon(t, world.handle);
  return { ctx: testContext(cfg, s.port), commands: s.commands, world };
}

test('army makes the pets asked for, tamed to the player, tagged, varied and immortal', async (t) => {
  const { ctx, world } = await setup(t);
  const out = await army(ctx, { _: ['army'], for: 'Alex_Builder', cats: 3, kittens: 2, dogs: 4, puppies: 1, interval: 0, seed: 5 });
  assert.equal(world.summoned.length, 10);
  assert.match(out[0], /^army: 10 of 10 pets for Alex_Builder \(3 cats, 2 kittens, 4 dogs, 1 puppies\), immortal/);
  for (const c of world.summoned) {
    assert.ok(c.includes('Owner:[I; 305419896, -1698935313, -2128394905, -1985229329]'), c);
    assert.ok(c.includes('Invulnerable:1b'));
    assert.ok(c.includes('"graftkit_pet"'));
  }
  assert.equal(world.summoned.filter((c) => c.includes('AgeLocked:1b')).length, 3);
  assert.equal(world.summoned.filter((c) => c.includes(' cat ')).length, 5);
  const dogCoats = new Set(world.summoned.filter((c) => c.includes(' wolf ')).map((c) => c.match(/variant:"minecraft:(\w+)"/)![1]));
  assert.equal(dogCoats.size, 5, 'each dog gets a different coat until the coats run out');
});

test('army refuses bad counts and unknown players before touching the server', async (t) => {
  const { ctx, commands } = await setup(t);
  await assert.rejects(army(ctx, { _: ['army'], for: 'Alex_Builder', cats: 9000 }), /--cats must be a whole number/);
  await assert.rejects(army(ctx, { _: ['army'], for: 'nobody' }), /hasn't joined/);
  await assert.rejects(army(ctx, { _: ['army'], for: 'bad name' }), /isn't a Minecraft player name/);
  assert.deepEqual(commands, []);
});

test('army --replace removes the old pets with death messages off, and turns them back on', async (t) => {
  const { ctx, commands } = await setup(t);
  const out = await army(ctx, { _: ['army'], for: 'Alex_Builder', cats: 1, kittens: 0, dogs: 0, puppies: 0, interval: 0, replace: true, 'no-show': true });
  assert.match(out[0], /replaced 3 old pets/);
  const i = commands.indexOf('gamerule show_death_messages false');
  assert.ok(i >= 0 && commands[i + 1].startsWith('kill @e[nbt={Owner:') && commands[i + 2] === 'gamerule show_death_messages true');
});

test('a house goes in front of the player, door toward them, and reports what it built', async (t) => {
  const { ctx, commands } = await setup(t, { Alex_Builder: [0.5, 64, 0.5, 180] }); // facing north
  const out = await house(ctx, { _: ['house'], near: 'Alex_Builder', dist: 10, seed: 1, style: 'cherry' });
  assert.match(out[0], /^house: cherry .* door south, at 0 64 -10 \(seed 1\)$/);
  assert.equal(out.length, 1, 'no problems reported');
  assert.ok(commands.some((c) => c.startsWith('setblock') && c.includes('cherry_door[facing=north,half=lower')));
});

test('bad targets and options are refused before touching the server', async (t) => {
  const { ctx, commands } = await setup(t);
  await assert.rejects(house(ctx, { _: ['house'], near: 'bad name' }), /isn't a Minecraft player name/);
  await assert.rejects(house(ctx, { _: ['house'], style: 'glass' }), /unknown style/);
  await assert.rejects(village(ctx, { _: ['village'], houses: 99 }), /--houses must be/);
  assert.deepEqual(commands, []);
});

test('targets must be online, and with several players online one must be named', async (t) => {
  const { ctx } = await setup(t, { Alex_Builder: [0, 64, 0, 0], Steve_Miner: [5, 64, 5, 0] });
  await assert.rejects(house(ctx, { _: ['house'] }), /2 players are online; say which/);
  await assert.rejects(house(ctx, { _: ['house'], near: 'nobody123' }), /isn't online/);
});

test('pets actions reach only that player\'s pets', async (t) => {
  const { ctx, commands } = await setup(t);
  await pets(ctx, { _: ['pets', 'sit'], for: 'Alex_Builder', type: 'dog' });
  assert.ok(commands.includes('execute as @e[type=wolf,nbt={Owner:[I; 305419896, -1698935313, -2128394905, -1985229329]}] run data merge entity @s {Sitting:1b}'));
  await assert.rejects(pets(ctx, { _: ['pets', 'explode'], for: 'Alex_Builder' }), /unknown pets action/);
  await assert.rejects(pets(ctx, { _: ['pets', 'kill'], for: 'Alex_Builder', keep: 'x]' }), /--keep takes a tag name/);
});

test('raid gives up after 75 seconds of game time without a village', async (t) => {
  const { ctx, commands } = await setup(t);
  const out = await player.raid(ctx, { _: ['raid'], for: 'Alex_Builder' });
  assert.match(out[0], /^no raid: Alex_Builder has Bad Omen but isn't in a village/);
  assert.equal(commands[0], 'effect give Alex_Builder bad_omen 6000 0');
  assert.equal(commands.filter((c) => c.includes('raid_omen')).length, 25); // one check every 3 s for 75 s
});

test('titles are JSON text components, so quotes in the text are safe', async (t) => {
  const { ctx, commands } = await setup(t);
  await player.title(ctx, { _: ['title', 'He said "hi"', 'small'], for: 'Alex_Builder' });
  assert.ok(commands.includes('title Alex_Builder title {"text":"He said \\"hi\\"","color":"gold","bold":true}'));
});

test('status lists players with position and mode, and server lag', async (t) => {
  const { ctx } = await setup(t);
  assert.deepEqual(await player.status(ctx), ['1 player(s) online:', '  Alex_Builder at -661 70 108 (survival)', '  server tick: 3.2 ms (the budget is 50; more means lag)']);
});
