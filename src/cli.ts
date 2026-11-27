#!/usr/bin/env node
// graftkit: a Graft mod manager and Minecraft server toolkit. Run `graftkit help`.
import fs from 'node:fs';
import { loadConfig, type Config } from './config.ts';
import { createContext } from './context.ts';
import { errorMessage } from './errors.ts';
import { ACTIONS } from './actions/index.ts';
import { parseArgs, type Opts } from './actions/util.ts';
import * as dashboard from './dashboard.ts';
import * as mods from './mods.ts';
import * as server from './server.ts';
import * as windows from './windows.ts';

export { ACTIONS };

export const HELP = `graftkit: Graft mod manager and Minecraft server toolkit

  graftkit dashboard [--no-open]     web dashboard: server, live console, mods, sharing, toolkit
  graftkit server start|stop|status
  graftkit share                     share Graft and the mods with friends' Macs until Ctrl+C
  graftkit mods                      published, switched-off and buildable mods
  graftkit mods build <project>      Gradle build (in WSL for WSL projects), then publish
  graftkit mods publish <project|jar>
  graftkit mods unpublish <jar>

Server actions (the server must be running; aim with --near/--for <player> or --at x,y,z):
  status                             who's online, where, in which mode, and server lag
  cmd "<command>" ...                raw server commands
  house [--near p] [--dist 10] [--style random|spruce|oak|birch|stone|brick|sandstone|cherry|mangrove|deepslate]
        [--size small|medium|large] [--roof gable|flat] [--facing north|south|east|west] [--seed n]
  village [--near p] [--houses 6] [--radius n] [--style ...] [--villagers 1] [--golems 0] [--seed n]
  army --for p [--cats 100 --kittens 100 --dogs 100 --puppies 100] [--interval 50] [--replace] [--mortal] [--no-show]
  pets count|gather|kill|immortal|mortal|babies|grow|sit|stand --for p [--type cat|dog] [--keep <tag>]
  immortal --for p [--off]
  gear --for p [--elytra] [--sword truezoom:thunderfury] [--rockets 64]
  raid --for p                       Bad Omen, then waits for the first wave (stand in a village)
  title --for p|@a "Big text" ["small text"]`;

function findProject(cfg: Config, name: unknown): mods.Project {
  const all = mods.projects(cfg);
  const hit = all.filter((p) => p.name.toLowerCase() === String(name).toLowerCase() || p.dir === name);
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) throw new Error(`"${name}" matches ${hit.length} projects; give the folder: ${hit.map((p) => p.dir).join(', ')}`);
  throw new Error(`no Graft mod project "${name}"; found: ${all.map((p) => p.name).join(', ') || 'none'}`);
}

async function modsCommand(cfg: Config, opts: Opts): Promise<string[]> {
  const sub = opts._[1] || 'list';
  if (sub === 'list') {
    const line = (m: mods.Jar) => `  ${m.file}  ${m.kind === 'graft' ? `${m.info.id} ${m.info.version}` : m.kind === 'other' ? '(not a Graft mod)' : `(unreadable: ${m.reason})`}`;
    const out = ['published (the server runs these; friends sync them):', ...mods.published(cfg).map(line)];
    const off = mods.disabled(cfg);
    if (off.length) out.push('switched off:', ...off.map(line));
    out.push('projects:', ...mods.projects(cfg).map((p) => `  ${p.name}  ${p.dir}  ${p.built ? `built: ${p.built.file}` : 'not built'}`));
    return out;
  }
  if (sub === 'publish') {
    const arg = opts._[2];
    if (!arg) throw new Error('mods publish <project|jar>');
    const jar = arg.endsWith('.jar') && fs.existsSync(arg) ? arg : findProject(cfg, arg).built?.path;
    if (!jar) throw new Error(`${arg} isn't built yet; run graftkit mods build ${arg}`);
    const r = mods.publish(cfg, jar);
    return [`published ${r.published} (${r.id} ${r.version})${r.replaced.length ? `, switched off ${r.replaced.join(', ')}` : ''}. Restart the server to load it; friends get it on their next sync.`];
  }
  if (sub === 'build') {
    const p = findProject(cfg, opts._[2]);
    const code = await mods.build(p.dir, (l) => { if (/BUILD|FAIL|error:|warning:/i.test(l)) console.log(`  ${l}`); });
    if (code !== 0) throw new Error(`the build of ${p.name} failed (exit ${code})`);
    const built = findProject(cfg, p.dir).built;
    if (!built) throw new Error(`${p.name} built, but there's no Graft mod jar in its build/libs`);
    const r = mods.publish(cfg, built.path);
    return [`built and published ${r.published} (${r.id} ${r.version}). Restart the server to load it.`];
  }
  if (sub === 'unpublish') { mods.unpublish(cfg, opts._[2]); return [`switched off ${opts._[2]}`]; }
  throw new Error(`unknown mods command "${sub}"`);
}

/** Runs one graftkit command line; resolves with the lines to print. The dashboard and share never resolve. */
export async function main(argv: readonly string[]): Promise<string[]> {
  const opts = parseArgs(argv);
  const cmd = opts._[0] || 'help';
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return HELP.split('\n');
  const cfg = loadConfig();
  const ctx = createContext(cfg);
  if (cmd === 'dashboard') return dashboard.run(ctx, opts);
  if (cmd === 'share') return dashboard.shareForeground(ctx);
  if (cmd === 'mods') return modsCommand(cfg, opts);
  if (cmd === 'server') {
    const sub = opts._[1] || 'status';
    const up = await server.isUp(cfg.serverDir);
    if (sub === 'status') return [up ? 'the server is running' : 'the server is not running'];
    if (sub === 'start') {
      if (up) return ['the server is already running'];
      await windows.startServer(cfg);
      return ['starting the server in its own window; accept the admin prompt so it can open its firewall port'];
    }
    if (sub === 'stop') {
      if (!up) return ['the server is not running'];
      const r = await ctx.connect();
      try { return [`server: ${await r.send('stop')}`]; } finally { r.close(); }
    }
    throw new Error(`unknown server command "${sub}"`);
  }
  if (Object.hasOwn(ACTIONS, cmd)) return ACTIONS[cmd](ctx, opts);
  throw new Error(`unknown command "${cmd}"; try graftkit help`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((lines) => {
    if (Array.isArray(lines)) console.log(lines.join('\n'));
  }, (e: unknown) => {
    console.error(`graftkit: ${errorMessage(e)}`);
    process.exit(1);
  });
}
