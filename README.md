# GraftKit

A mod manager for [Graft](https://github.com/Brendan-Black/Graft) mods and a toolkit for the Minecraft server they run on.

- **Share mods with friends' Macs** over the local network. A friend runs one command; their Mac then matches the
  server exactly: Graft, every published mod, and a launcher installation that starts the game with Graft.
- **Run the server** from a web dashboard with a live console you can type commands into.
- **Drive the server with short actions**: build a varied house or a whole village, raise an army of pets, gear a player
  up, start a raid. One action replaces hundreds of hand-written commands.

Only Graft mods (jars with `graft.mod.properties`) are published or shared, and only over the local network.

## Setting up

You need Windows with Node 24 or later, PowerShell 7 (`pwsh`), and a Minecraft server folder with Graft
(`graft.jar` next to the vanilla `server.jar`) and RCON switched on in `server.properties`.

1. Copy `graftkit.example.json` to `graftkit.json` and fill in the server folder, where your Graft mod projects live
   (`modRoots`), the ports, and the name of the launcher installation friends get.
2. Run `graftkit help` (or `node src\cli.js help`).

GraftKit runs with **Windows** Node even when its code sits in WSL, because the server, its RCON console, the firewall
and the network a friend's Mac reaches are all on the Windows side; WSL's NAT network reaches none of them. Run it by
its Windows path, for example `node \\wsl.localhost\<distro>\home\<you>\GraftKit\src\cli.js help`. Mod projects that
live in WSL are built in WSL (`wsl.exe -d <distro> --cd <project> -- ./gradlew build`).

To let Claude Code drive the server with these actions, copy `skill/SKILL.md` to `~/.claude/skills/graftkit/SKILL.md`
and change its paths and player names to yours.

## Commands

```
graftkit dashboard                 web dashboard on http://127.0.0.1:8770: server, console, mods, sharing, toolkit
graftkit server start|stop|status
graftkit share                     share with Macs until Ctrl+C
graftkit mods [list|build <project>|publish <project|jar>|unpublish <jar>]
graftkit <action> ...              see `graftkit help`: status, cmd, house, village, army, pets, immortal, gear, raid, title
```

`server start` opens the server in a console window of its own, running as you. Its port is open in the firewall to
local networks only while it runs (one admin prompt to open, one to close). Sharing does the same for its port, 8765.

## A friend's Mac

With sharing on, the friend runs, in Terminal (the dashboard shows the exact line to copy):

```console
$ curl -fsSL http://<pc>:8765/sync | bash
```

It installs Graft in `~/graft`, syncs `~/Library/Application Support/minecraft/mods` to the server's mods (removing only
mods it installed itself), and adds a "Graft (26.3)" installation to the launcher; the launcher has to be closed for
that last step. Running it again updates everything. If the game crashes,
`curl -fsSL http://<pc>:8765/debug | bash` sends a report back; it shows up in the dashboard.

The scripts in `mac/` are fixed files with one slot, `@SHARE_URL@`, which the share fills with its own address: the
address of this machine that the Mac connected to, taken from the operating system's own list of interfaces (never from
the request), checked against a pattern with no shell metacharacters, and inside single quotes. Everything else comes
from the mod list as data. An address given as the script's first argument takes the slot's place.

## Tests

```console
$ npm test
```

They bring what they need: a pseudo RCON server that behaves like the vanilla one where it matters (one packet per read,
long replies split into 4096-byte packets), throwaway server folders and jars, and `sync.sh` run in bash against a live
share with the macOS-only tools (`shasum`, `osascript`, `pgrep`) replaced on `PATH`. The Windows pieces (firewall rules,
starting the server) are thin PowerShell scripts in `win/` and are checked by hand.
