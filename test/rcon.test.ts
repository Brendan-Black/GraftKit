import test from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { Rcon } from '../src/rcon.ts';
import { pseudoRcon } from './helpers.ts';

test('a short reply comes back whole', async (t) => {
  const s = await pseudoRcon(t, (c) => (c === 'list' ? 'There are 0 of a max of 10 players online:' : ''));
  const r = await Rcon.connect({ port: s.port, password: 'pw' });
  t.after(() => r.close());
  assert.equal(await r.send('list'), 'There are 0 of a max of 10 players online:');
});

test('a reply split over several packets is joined, and the next reply is not mixed into it', async (t) => {
  const long = 'Summoned new Wolf'.repeat(1000); // 17,000 characters: five packets
  const s = await pseudoRcon(t, (c) => (c === 'many' ? long : 'short'));
  const r = await Rcon.connect({ port: s.port, password: 'pw' });
  t.after(() => r.close());
  const [a, b] = await Promise.all([r.send('many'), r.send('next')]);
  assert.equal(a, long);
  assert.equal(b, 'short');
  assert.deepEqual(s.commands, ['many', 'next']);
});

test('an empty reply resolves to an empty string', async (t) => {
  const s = await pseudoRcon(t, () => '');
  const r = await Rcon.connect({ port: s.port, password: 'pw' });
  t.after(() => r.close());
  assert.equal(await r.send('say hi'), '');
});

test('a wrong password is an error, not a hang', async (t) => {
  const s = await pseudoRcon(t, () => 'x', { password: 'right' });
  await assert.rejects(Rcon.connect({ port: s.port, password: 'wrong' }), /rejected the RCON password/);
});

test('no server is an error that says what to check', async () => {
  await assert.rejects(Rcon.connect({ port: 1, password: 'x' }), /can't reach the server's RCON.*is the server running/);
});

test('a dropped connection fails the command in flight', async (t) => {
  const sockets: Socket[] = [];
  const s = await pseudoRcon(t, () => { setImmediate(() => sockets.forEach((x) => x.destroy())); return ''; });
  s.server.on('connection', (sock) => sockets.push(sock));
  const r = await Rcon.connect({ port: s.port, password: 'pw' });
  await assert.rejects(r.send('stop'), /closed/);
});
