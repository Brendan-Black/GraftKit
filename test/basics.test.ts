import test from 'node:test';
import assert from 'node:assert/strict';
import { playerName, jarFileName, intIn, wslLocation } from '../src/values.ts';
import { uuidIntArray, uuidOf } from '../src/players.ts';
import { parseArgs, facing, rng } from '../src/actions/util.ts';
import { splitLine } from '../src/dashboard.ts';
import { buildCommand } from '../src/mods.ts';
import { tempServer } from './helpers.ts';

test('player names are checked before they reach a command', () => {
  assert.equal(playerName('Alex_Builder'), 'Alex_Builder');
  for (const bad of ['', 'ab', 'a'.repeat(17), 'bob]', 'x y', '@a', 'bob;stop']) assert.throws(() => playerName(bad), /isn't a Minecraft player name/);
});

test('jar names and numbers are checked', () => {
  assert.equal(jarFileName('TrueZoom-1.0.0.jar'), 'TrueZoom-1.0.0.jar');
  for (const bad of ['../x.jar', 'a/b.jar', 'x.zip', 'a b.jar']) assert.throws(() => jarFileName(bad));
  assert.equal(intIn('12', 1, 20, 'n'), 12);
  for (const bad of ['0', '21', '1.5', 'x']) assert.throws(() => intIn(bad, 1, 20, 'n'), /whole number from 1 to 20/);
});

test('WSL paths seen from Windows map to their distro and Linux path', () => {
  assert.deepEqual(wslLocation('\\\\wsl.localhost\\Ubuntu\\home\\dev\\mods\\Zoom'), { distro: 'Ubuntu', linuxPath: '/home/dev/mods/Zoom' });
  assert.deepEqual(wslLocation('\\\\wsl$\\Alpine\\home'), { distro: 'Alpine', linuxPath: '/home' });
  assert.equal(wslLocation('D:\\minecraft-server'), null);
});

test('WSL projects build inside WSL, others with gradlew.bat', () => {
  const w = buildCommand('\\\\wsl.localhost\\Ubuntu\\home\\dev\\mods\\Zoom');
  assert.equal(w.cmd, 'wsl.exe');
  assert.deepEqual(w.args.slice(0, 4), ['-d', 'Ubuntu', '--cd', '/home/dev/mods/Zoom']);
  const win = buildCommand('C:\\mods\\X');
  assert.match(win.cmd, /gradlew\.bat$/);
});

test('UUIDs become the int arrays Minecraft uses for Owner (expected values worked out separately)', () => {
  assert.equal(uuidIntArray('fedcba98-7654-4321-8fed-cba987654321'), '[I; -19088744, 1985233697, -1880241239, -2023406815]');
  assert.equal(uuidIntArray('12345678-9abc-4def-8123-456789abcdef'), '[I; 305419896, -1698935313, -2128394905, -1985229329]');
  assert.throws(() => uuidIntArray('nope'), /isn't a UUID/);
});

test('players are looked up in usercache.json, ignoring case', (t) => {
  const { dir } = tempServer(t);
  assert.equal(uuidOf(dir, 'ALEX_BUILDER').uuid, '12345678-9abc-4def-8123-456789abcdef');
  assert.throws(() => uuidOf(dir, 'nobody123'), /hasn't joined/);
});

test('options parse into flags, values and positionals', () => {
  assert.deepEqual(parseArgs(['house', '--near', 'bob', '--fast', '--size=large', 'x']), { _: ['house', 'x'], near: 'bob', fast: true, size: 'large' });
  assert.deepEqual(splitLine('title --for bob "Big news" "small print"'), ['title', '--for', 'bob', 'Big news', 'small print']);
});

test('yaw maps to the direction faced (0 is south)', () => {
  assert.equal(facing(0), 'south'); assert.equal(facing(90), 'west'); assert.equal(facing(180), 'north');
  assert.equal(facing(-90), 'east'); assert.equal(facing(-180), 'north'); assert.equal(facing(359), 'south');
});

test('a seed reproduces the same random choices', () => {
  const a = rng(42), b = rng(42);
  assert.deepEqual(Array.from({ length: 5 }, () => a.int(0, 1000)), Array.from({ length: 5 }, () => b.int(0, 1000)));
});
