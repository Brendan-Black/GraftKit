// Graft mods: what the server publishes (serverDir/mods), what's switched off (mods-disabled), and the Graft mod
// projects under modRoots that can be built and published. A jar counts as a Graft mod only if it has
// graft.mod.properties.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { readText } = require('./zip');
const { jarFileName, wslLocation } = require('./values');

const PROPERTIES = 'graft.mod.properties';

function parseProps(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * What a jar is: { kind: 'graft', info } for a Graft mod, { kind: 'other' } for any other jar, and
 * { kind: 'unreadable', reason } for one that can't be opened.
 */
function inspect(jar) {
  let text;
  try {
    text = readText(jar, PROPERTIES);
  } catch (e) {
    return { kind: 'unreadable', reason: e.message };
  }
  if (text === null) return { kind: 'other' };
  const p = parseProps(text);
  if (!p.id) return { kind: 'unreadable', reason: `${PROPERTIES} has no id` };
  return { kind: 'graft', info: { id: p.id, name: p.name || p.id, version: p.version || '?', description: p.description || '', minecraft: p['depends.minecraft'] || '', graft: p['depends.graft'] || '' } };
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function jarsIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jar')).map((f) => {
    const file = path.join(dir, f);
    const st = fs.statSync(file);
    return { file: f, path: file, size: st.size, modified: st.mtimeMs, ...inspect(file) };
  });
}

const published = (cfg) => jarsIn(cfg.modsDir);
const disabled = (cfg) => jarsIn(cfg.disabledDir);

/** What a friend's Mac syncs to: Graft itself plus every published Graft mod, with checksums. */
function manifest(cfg) {
  const mods = published(cfg).filter((m) => m.kind === 'graft').map((m) => ({ file: m.file, sha256: sha256(m.path), size: m.size, id: m.info.id, version: m.info.version }));
  return { minecraft: cfg.minecraft, profileName: cfg.profileName, graft: { sha256: sha256(cfg.graftJar), size: fs.statSync(cfg.graftJar).size }, mods };
}

const SKIP = new Set(['build', 'node_modules', 'run', 'gradle', 'out', 'target', 'bin']);

/** Graft mod projects (a build.gradle.kts applying black.graft.mod) under modRoots, with their newest built jar. */
function projects(cfg) {
  const found = [];
  const walk = (dir, depth) => {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a folder we may not read isn't a project of ours; discovery carries on without it
    }
    if (names.some((d) => d.isFile() && d.name === 'build.gradle.kts') &&
        /id\("black\.graft\.mod"\)/.test(fs.readFileSync(path.join(dir, 'build.gradle.kts'), 'utf8'))) {
      const libs = jarsIn(path.join(dir, 'build', 'libs')).filter((j) => j.kind === 'graft' && !/-(sources|javadoc)\.jar$/.test(j.file));
      libs.sort((a, b) => b.modified - a.modified);
      found.push({ dir, name: path.basename(dir), built: libs[0] || null });
    }
    if (depth > 0) for (const d of names) if (d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name)) walk(path.join(dir, d.name), depth - 1);
  };
  for (const root of cfg.modRoots) {
    if (!fs.existsSync(root)) throw new Error(`mod folder ${root} (modRoots in graftkit.json) doesn't exist or isn't reachable`);
    walk(root, 3);
  }
  return found;
}

/**
 * Publishes a Graft mod jar: it lands in the server's mods, and other jars of the same mod id move to mods-disabled.
 * All or nothing: the jar is copied under a temporary name first, and moves are undone if a later step fails.
 */
function publish(cfg, jarPath) {
  const what = inspect(jarPath);
  if (what.kind !== 'graft') throw new Error(`${path.basename(jarPath)} isn't a Graft mod (${what.kind === 'other' ? `no ${PROPERTIES}` : what.reason})`);
  const name = jarFileName(path.basename(jarPath));
  fs.mkdirSync(cfg.modsDir, { recursive: true });
  fs.mkdirSync(cfg.disabledDir, { recursive: true });
  const temp = path.join(cfg.modsDir, `.${name}.part`);
  fs.copyFileSync(jarPath, temp);
  const moved = [];
  try {
    for (const m of published(cfg)) {
      if (m.kind === 'graft' && m.info.id === what.info.id && m.file !== name) {
        fs.renameSync(m.path, path.join(cfg.disabledDir, m.file));
        moved.push(m.file);
      }
    }
    fs.renameSync(temp, path.join(cfg.modsDir, name));
  } catch (e) {
    for (const f of moved) fs.renameSync(path.join(cfg.disabledDir, f), path.join(cfg.modsDir, f));
    fs.rmSync(temp, { force: true });
    throw new Error(`publishing ${name} failed; nothing changed: ${e.message}`, { cause: e });
  }
  return { published: name, id: what.info.id, version: what.info.version, replaced: moved };
}

/** Switches a published mod off (moves it to mods-disabled). */
function unpublish(cfg, file) {
  const name = jarFileName(file);
  fs.mkdirSync(cfg.disabledDir, { recursive: true });
  fs.renameSync(path.join(cfg.modsDir, name), path.join(cfg.disabledDir, name));
}

/** Switches a mod back on; the published jar of the same mod id, if any, is switched off. */
function republish(cfg, file) {
  const r = publish(cfg, path.join(cfg.disabledDir, jarFileName(file)));
  fs.rmSync(path.join(cfg.disabledDir, r.published));
  return r;
}

/** How to build a project: in its WSL distro when it lives in WSL, else with gradlew.bat. */
function buildCommand(dir) {
  const wsl = wslLocation(dir);
  if (wsl) return { cmd: 'wsl.exe', args: ['-d', wsl.distro, '--cd', wsl.linuxPath, '--', 'bash', '-lc', './gradlew build --console=plain'], cwd: undefined };
  return { cmd: path.join(dir, 'gradlew.bat'), args: ['build', '--console=plain'], cwd: dir };
}

/** Runs the project's Gradle build; onLine gets each output line. Resolves with the exit code. */
function build(dir, onLine) {
  const { cmd, args, cwd } = buildCommand(dir);
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    const feed = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach(onLine);
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (e) => reject(new Error(`couldn't start the build for ${dir}: ${e.message}`, { cause: e })));
    p.on('close', resolve);
  });
}

module.exports = { inspect, sha256, published, disabled, manifest, projects, publish, unpublish, republish, build, buildCommand };
