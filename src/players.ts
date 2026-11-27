// Account UUIDs from the server's usercache.json, in the int-array form Minecraft uses for a pet's Owner.
import fs from 'node:fs';
import path from 'node:path';
import { playerName } from './values.ts';

export function uuidOf(serverDir: string, name: unknown): { name: string; uuid: string } {
  const wanted = playerName(name).toLowerCase();
  const file = path.join(serverDir, 'usercache.json');
  if (!fs.existsSync(file)) throw new Error(`no usercache.json in ${serverDir}; has anyone joined this server?`);
  const cache = JSON.parse(fs.readFileSync(file, 'utf8')) as { name: string; uuid: string }[];
  const hit = cache.find((e) => String(e.name).toLowerCase() === wanted);
  if (!hit) throw new Error(`${name} hasn't joined this server (not in usercache.json)`);
  return { name: hit.name, uuid: hit.uuid };
}

/** "fedcba98-7654-4321-8fed-cba987654321" -> "[I; -19088744, 1985233697, -1880241239, -2023406815]" */
export function uuidIntArray(uuid: string): string {
  const hex = String(uuid).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`"${uuid}" isn't a UUID`);
  const ints = [0, 1, 2, 3].map((i) => {
    const n = parseInt(hex.slice(i * 8, i * 8 + 8), 16);
    return n > 0x7fffffff ? n - 0x100000000 : n;
  });
  return `[I; ${ints.join(', ')}]`;
}
