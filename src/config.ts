// Settings: graftkit.json at the repository root (start from graftkit.example.json). GRAFTKIT_CONFIG names another
// file, GRAFTKIT_SERVER another server folder.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** What graftkit.json holds. */
export interface Settings {
  serverDir: string;
  modRoots?: string[];
  minecraft: string;
  sharePort: number;
  dashboardPort: number;
  serverRam?: string;
  profileName: string;
}

/** The settings with the folders and files derived from serverDir. */
export interface Config extends Readonly<Omit<Settings, 'modRoots'>> {
  readonly modsDir: string;
  readonly disabledDir: string;
  readonly graftJar: string;
  readonly dataDir: string;
  readonly modRoots: readonly string[];
}

export function loadConfig({ file = process.env.GRAFTKIT_CONFIG || path.join(ROOT, 'graftkit.json'), serverDir = process.env.GRAFTKIT_SERVER }: { file?: string; serverDir?: string | undefined } = {}): Config {
  if (!fs.existsSync(file)) throw new Error(`no settings at ${file}: copy graftkit.example.json to graftkit.json and edit it`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Settings;
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
export function readProps(serverDir: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    props[line.slice(0, i)] = line.slice(i + 1);
  }
  return props;
}
