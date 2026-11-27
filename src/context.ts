// What actions are handed: the settings, a way to reach the server, a clock and a way to wait. The entry points build
// the real one; tests build their own.
import { performance } from 'node:perf_hooks';
import type { Config } from './config.ts';
import { Rcon, rconSettings } from './rcon.ts';

export interface Context {
  cfg: Config;
  connect(): Promise<Rcon>;
  clock: { now(): number; wall(): number }; // now() measures elapsed time; wall() stamps names
  sleep(ms: number): Promise<void>;
}

export function createContext(cfg: Config, overrides: Partial<Context> = {}): Context {
  return {
    cfg,
    connect: () => Rcon.connect(rconSettings(cfg.serverDir)),
    clock: { now: () => performance.now(), wall: () => Date.now() },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };
}
