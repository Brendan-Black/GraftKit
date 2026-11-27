// Settings: graftkit.json at the repository root (start from graftkit.example.json). GRAFTKIT_CONFIG names another
// file, GRAFTKIT_SERVER another server folder.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadConfig({ file = process.env.GRAFTKIT_CONFIG || path.join(ROOT, 'graftkit.json'), serverDir = process.env.GRAFTKIT_SERVER } = {}) {
  if (!fs.existsSync(file)) throw new Error(`no settings at ${file}: copy graftkit.example.json to graftkit.json and edit it`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = serverDir || raw.serverDir;
  if (!dir) throw new Error(`${file} has no serverDir`);
  return Object.freeze({
    ...raw,
    serverDir: dir,
    modsDir: path.join(dir, 'mods'),
    disabledDir: path.join(dir, 'mods-disabled'),
    graftJar: path.join(dir, 'graft.jar'),
    dataDir: path.join(dir, 'graftkit'),
    modRoots: raw.modRoots || [],
  });
}

/** server.properties as a plain object. */
function readProps(serverDir) {
  const props = {};
  for (const line of fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    props[line.slice(0, i)] = line.slice(i + 1);
  }
  return props;
}

module.exports = { ROOT, loadConfig, readProps };
