# Changelog

## Unreleased

- **TypeScript.** GraftKit is now TypeScript, checked with TypeScript 7 (`npm run typecheck`, also run in CI). Node
  runs the `.ts` files directly, so there is still no build step and nothing to install to run it. Run it with
  `node src\cli.ts` (`graftkit.cmd` does this); it needs Node 24.2 or later.
- `mac/profile.js` is now `mac/profile.cjs` on disk. Macs still download it as `/profile.js`, so nothing changes for them.
- **Starting the server works again.** The dashboard's Start button and `server start` launched PowerShell with no
  console, so it quit without doing anything and without an error. The server window is now opened by
  `win/start-server.ps1`, and a launch that fails says why. If the server can't start, its window stays open showing the
  problem instead of closing at once.
- `house --facing` with no direction, or `--facing random`, faces the way the player looks instead of failing.

## 0.1.0

The first release.

- **Sharing with Macs.** While sharing is on, a friend runs `curl -fsSL http://<pc>:8765/sync | bash`, and their Mac
  matches the server: Graft in `~/graft`, every published mod (and none it installed earlier that the server dropped),
  and a launcher installation that starts the game with Graft. `curl -fsSL http://<pc>:8765/debug | bash` sends a
  report back. Sharing opens its port to local networks only, and only while it's on.
- **Dashboard** on `http://127.0.0.1:8770`: start and stop the server, a live console you can type commands into,
  published and switched-off mods, building and publishing mod projects, sharing, and Macs' reports.
- **Actions** that each replace a stream of commands: `house` (nine styles, three sizes, gabled or flat roofs, chosen
  at random or by seed), `village` (a ring of houses that raids recognise), `army` (tamed cats and dogs in a fountain),
  `pets`, `immortal`, `gear`, `raid`, `title`, `status` and `cmd`.
- **Mods** are only ever Graft mods: `mods build` builds a project (in WSL for WSL projects) and publishes it, and
  publishing is all or nothing.
