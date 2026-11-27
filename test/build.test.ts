import test from 'node:test';
import assert from 'node:assert/strict';
import { houseCommands, STYLES, SIZES } from '../src/actions/house.ts';
import { villageCommands, sideToward } from '../src/actions/village.ts';
import { rng } from '../src/actions/util.ts';

const COMMAND = /^(fill -?\d+ -?\d+ -?\d+ -?\d+ -?\d+ -?\d+ [a-z_]+(\[[a-z_=,]+\])?( replace [a-z_]+| hollow)?|setblock -?\d+ -?\d+ -?\d+ [a-z_]+(\[[a-z_=,]+\])?|summon (villager|iron_golem) [-\d.]+ -?\d+ [-\d.]+( \{PlayerCreated:1b\})?)$/;

test('the same seed builds the same house', () => {
  const a = houseCommands({ x: 0, y: 64, z: 0 }, 'north', rng(7));
  const b = houseCommands({ x: 0, y: 64, z: 0 }, 'north', rng(7));
  assert.deepEqual(a.commands, b.commands);
});

test('every style, size, roof and door side gives well-formed commands', () => {
  for (const style of Object.keys(STYLES)) for (const size of Object.keys(SIZES)) for (const roof of ['gable', 'flat']) for (const door of ['north', 'south', 'east', 'west'] as const) {
    const { commands, info } = houseCommands({ x: 10, y: 70, z: -5 }, door, rng(style.length * 31 + door.length), { style, size, roof });
    for (const c of commands) assert.match(c, COMMAND, `${style}/${size}/${roof}/${door}: ${c}`);
    assert.equal(info.style, style);
    assert.equal(info.roof, roof);
  }
});

test('the door is in the wall it was asked for, and the bed is inside, away from the door', () => {
  for (let seed = 0; seed < 200; seed++) for (const door of ['north', 'south', 'east', 'west'] as const) {
    const { info } = houseCommands({ x: 0, y: 64, z: 0 }, door, rng(seed));
    const [dx, dz] = info.doorAt;
    if (door === 'north') assert.equal(dz, info.z0); if (door === 'south') assert.equal(dz, info.z1);
    if (door === 'west') assert.equal(dx, info.x0); if (door === 'east') assert.equal(dx, info.x1);
    for (const [bx, bz] of info.bed) {
      assert.ok(bx > info.x0 && bx < info.x1 && bz > info.z0 && bz < info.z1, `bed tile ${bx},${bz} is inside (seed ${seed}, ${door})`);
      const inside = { north: [dx, dz + 1], south: [dx, dz - 1], west: [dx + 1, dz], east: [dx - 1, dz] }[door];
      assert.notDeepEqual([bx, bz], inside, 'the bed never blocks the doorway');
    }
  }
});

test('houses vary: random builds use several styles, sizes and roofs', () => {
  const infos = Array.from({ length: 60 }, (_, i) => houseCommands({ x: 0, y: 64, z: 0 }, 'south', rng(i)).info);
  assert.ok(new Set(infos.map((i) => i.style)).size >= 6);
  assert.ok(new Set(infos.map((i) => `${i.w}x${i.d}`)).size >= 6);
  assert.deepEqual(new Set(infos.map((i) => i.roof)), new Set(['gable', 'flat']));
});

test('unknown styles and sizes are refused with the choices', () => {
  assert.throws(() => houseCommands({ x: 0, y: 0, z: 0 }, 'north', rng(1), { style: 'glass' }), /unknown style "glass"; try spruce/);
  assert.throws(() => houseCommands({ x: 0, y: 0, z: 0 }, 'north', rng(1), { size: 'huge' }), /unknown size/);
});

test('village houses face the middle and the village has a bell and villagers', () => {
  assert.equal(sideToward(10, 0, 0, 0), 'west');
  assert.equal(sideToward(0, -10, 0, 0), 'south');
  const v = villageCommands({ x: -660, y: 70, z: 108 }, rng(3), { houses: 6, golems: 2 });
  assert.equal(v.houses.length, 6);
  for (const h of v.houses) assert.equal(h.door, sideToward(h.cx, h.cz, -660, 108));
  assert.ok(v.commands.includes('setblock -658 70 108 bell[attachment=floor]'));
  assert.equal(v.commands.filter((c) => c.startsWith('summon villager')).length, 6);
  assert.equal(v.commands.filter((c) => c.startsWith('summon iron_golem')).length, 2);
  for (const c of v.commands) assert.match(c, COMMAND, c);
  assert.throws(() => villageCommands({ x: 0, y: 0, z: 0 }, rng(1), { houses: 40 }), /--houses must be/);
});
