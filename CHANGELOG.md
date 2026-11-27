# Changelog

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
