// What actions are handed: the settings, a way to reach the server, a clock and a way to wait. The entry points build
// the real one; tests build their own.
const { performance } = require('perf_hooks');
const { Rcon, rconSettings } = require('./rcon');

function createContext(cfg, overrides = {}) {
  return {
    cfg,
    connect: () => Rcon.connect(rconSettings(cfg.serverDir)),
    clock: { now: () => performance.now(), wall: () => Date.now() }, // now() measures elapsed time; wall() stamps names
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };
}

module.exports = { createContext };
