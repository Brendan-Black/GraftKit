// Account UUIDs from the server's usercache.json, in the int-array form Minecraft uses for a pet's Owner.
const fs = require('fs');
const path = require('path');
const { playerName } = require('./values');

function uuidOf(serverDir, name) {
  const wanted = playerName(name).toLowerCase();
  const file = path.join(serverDir, 'usercache.json');
  if (!fs.existsSync(file)) throw new Error(`no usercache.json in ${serverDir}; has anyone joined this server?`);
  const hit = JSON.parse(fs.readFileSync(file, 'utf8')).find((e) => String(e.name).toLowerCase() === wanted);
  if (!hit) throw new Error(`${name} hasn't joined this server (not in usercache.json)`);
  return { name: hit.name, uuid: hit.uuid };
}

/** "fedcba98-7654-4321-8fed-cba987654321" -> "[I; -19088744, 1985233697, -1880241239, -2023406815]" */
function uuidIntArray(uuid) {
  const hex = String(uuid).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`"${uuid}" isn't a UUID`);
  const ints = [0, 1, 2, 3].map((i) => {
    const n = parseInt(hex.slice(i * 8, i * 8 + 8), 16);
    return n > 0x7fffffff ? n - 0x100000000 : n;
  });
  return `[I; ${ints.join(', ')}]`;
}

module.exports = { uuidOf, uuidIntArray };
