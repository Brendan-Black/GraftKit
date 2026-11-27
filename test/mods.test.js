const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mods = require('../src/mods');
const { tempServer, graftMod, makeJar } = require('./helpers');

function put(dir, name, buf) { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; }

test('jars are told apart: Graft mods, other jars, and damaged ones', (t) => {
  const { dir } = tempServer(t);
  assert.deepEqual(mods.inspect(put(dir, 'a.jar', graftMod('zoom', '1.0'))).info.id, 'zoom');
  assert.equal(mods.inspect(put(dir, 'b.jar', makeJar({ 'fabric.mod.json': '{}' }))).kind, 'other');
  const broken = mods.inspect(put(dir, 'c.jar', Buffer.from('not a zip')));
  assert.equal(broken.kind, 'unreadable');
  assert.match(broken.reason, /not a zip/);
});

test('publishing a new version switches the old one off', (t) => {
  const { dir, cfg } = tempServer(t);
  put(cfg.modsDir, 'zoom-1.0.jar', graftMod('zoom', '1.0'));
  put(cfg.modsDir, 'other-2.0.jar', graftMod('other', '2.0'));
  const r = mods.publish(cfg, put(path.join(dir, 'build'), 'zoom-1.1.jar', graftMod('zoom', '1.1')));
  assert.deepEqual(r, { published: 'zoom-1.1.jar', id: 'zoom', version: '1.1', replaced: ['zoom-1.0.jar'] });
  assert.deepEqual(fs.readdirSync(cfg.modsDir).sort(), ['other-2.0.jar', 'zoom-1.1.jar']);
  assert.deepEqual(fs.readdirSync(cfg.disabledDir), ['zoom-1.0.jar']);
});

test('only Graft mods can be published', (t) => {
  const { dir, cfg } = tempServer(t);
  assert.throws(() => mods.publish(cfg, put(dir, 'fabric.jar', makeJar({ 'fabric.mod.json': '{}' }))), /isn't a Graft mod/);
  assert.deepEqual(fs.readdirSync(cfg.modsDir), []);
});

test('a publish that fails partway leaves everything as it was', (t) => {
  const { dir, cfg } = tempServer(t);
  put(cfg.modsDir, 'zoom-1.0.jar', graftMod('zoom', '1.0'));
  const jar = put(path.join(dir, 'build'), 'zoom-1.1.jar', graftMod('zoom', '1.1'));
  fs.mkdirSync(path.join(cfg.modsDir, 'zoom-1.1.jar')); // a folder where the jar must go makes the final rename fail
  assert.throws(() => mods.publish(cfg, jar), /nothing changed/);
  assert.deepEqual(fs.readdirSync(cfg.modsDir).sort(), ['zoom-1.0.jar', 'zoom-1.1.jar']);
  assert.ok(fs.statSync(path.join(cfg.modsDir, 'zoom-1.1.jar')).isDirectory());
  assert.deepEqual(fs.readdirSync(cfg.disabledDir), []);
});

test('switching a mod off and on again', (t) => {
  const { cfg } = tempServer(t);
  put(cfg.modsDir, 'zoom-1.0.jar', graftMod('zoom', '1.0'));
  mods.unpublish(cfg, 'zoom-1.0.jar');
  assert.deepEqual(fs.readdirSync(cfg.modsDir), []);
  mods.republish(cfg, 'zoom-1.0.jar');
  assert.deepEqual(fs.readdirSync(cfg.modsDir), ['zoom-1.0.jar']);
  assert.deepEqual(fs.readdirSync(cfg.disabledDir), []);
  assert.throws(() => mods.unpublish(cfg, '../escape.jar'), /plain jar file name/);
});

test('the manifest lists Graft and each published Graft mod with checksums', (t) => {
  const { cfg } = tempServer(t);
  put(cfg.modsDir, 'zoom-1.0.jar', graftMod('zoom', '1.0'));
  put(cfg.modsDir, 'fabric.jar', makeJar({ 'fabric.mod.json': '{}' }));
  const m = mods.manifest(cfg);
  assert.equal(m.minecraft, '26.3');
  assert.deepEqual(m.mods.map((x) => [x.file, x.id, x.version]), [['zoom-1.0.jar', 'zoom', '1.0']]);
  assert.match(m.graft.sha256, /^[0-9a-f]{64}$/);
});

test('projects are Gradle builds that apply black.graft.mod, with their newest Graft jar', (t) => {
  const { dir } = tempServer(t);
  const root = path.join(dir, 'src');
  put(path.join(root, 'Zoom'), 'build.gradle.kts', 'plugins { id("black.graft.mod") version "v0.1.0" }');
  put(path.join(root, 'Zoom', 'build', 'libs'), 'Zoom-1.0.jar', graftMod('zoom', '1.0'));
  put(path.join(root, 'Zoom', 'build', 'libs'), 'Zoom-1.0-sources.jar', graftMod('zoom', '1.0'));
  put(path.join(root, 'Plain'), 'build.gradle.kts', 'plugins { java }');
  const found = mods.projects({ modRoots: [root] });
  assert.deepEqual(found.map((p) => [p.name, p.built && p.built.file]), [['Zoom', 'Zoom-1.0.jar']]);
  assert.throws(() => mods.projects({ modRoots: [path.join(dir, 'missing')] }), /doesn't exist/);
});
