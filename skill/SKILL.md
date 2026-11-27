---
name: graftkit
description: Drive a Graft Minecraft server and its mods with GraftKit. Use whenever the user asks for something in their Minecraft world or server: building houses or villages, spawning pets or mobs, giving items or gear, buffs or immortality, raids, titles, teleporting, gamerules, starting or stopping the server, or publishing and sharing Graft mods with a friend's Mac.
---

# GraftKit

<!-- Copy this file to ~/.claude/skills/graftkit/SKILL.md and replace the two placeholders below. -->

Run it with **Windows** Node (the server, its RCON, the firewall and the LAN are on the Windows side):

```
node <path to GraftKit>\src\cli.js <command> [options]
```

Prefer an action over writing raw commands: one short call, a one-line summary back. Use `cmd` for anything no action
covers. Every action needs the server running (`server status`); start it with `server start` (the user accepts an
admin prompt for the firewall). Players: <the user's and their friends' Minecraft names>.

| Task | Command |
|---|---|
| Who's online, where, lag | `status` |
| Any server command | `cmd "time set day" "gamerule advance_time false"` |
| A house in front of someone | `house --near <p> [--style spruce/oak/birch/stone/brick/sandstone/cherry/mangrove/deepslate] [--size small/medium/large] [--roof gable/flat] [--dist 10]` |
| A village around someone (raids work there) | `village --near <p> [--houses 6] [--golems 2]` |
| Tamed pet army in a fountain | `army --for <p> [--cats 100 --kittens 100 --dogs 100 --puppies 100] [--interval 50] [--replace]` |
| Manage someone's pets | `pets count/gather/kill/immortal/mortal/babies/grow/sit/stand --for <p> [--type cat/dog]` |
| Immortality buffs | `immortal --for <p>` (`--off` clears effects) |
| Full enchanted netherite and a sword | `gear --for <p> [--elytra] [--rockets 64] [--sword <item id>]` |
| Raid (stand in a village) | `raid --for <p>` |
| On-screen title | `title --for <p>/@a "Big" "small"` |
| Mods | `mods`, `mods build <project>`, `mods publish <project>`, `mods unpublish <jar>` (restart the server to load) |
| Web dashboard with live console | `dashboard` |

Things learned the hard way:

- Minecraft 26.x gamerules are snake_case: `advance_time`, `spawn_monsters`, `max_entity_cramming`, `freeze_damage`.
- Commands reach only loaded parts of the world: pets left far behind can't be counted or gathered.
- Mass spawns: never multiply entities by "doubling" a reusable tag; `army` sends one summon per pet with a fresh tag.
- Creative-mode players can hurt Invulnerable mobs; keep a player in survival if their pets must be safe from them.
- A friend's Mac syncs with `curl -fsSL http://<pc>:8765/sync | bash` while sharing is on (`dashboard` or `share`);
  reports they send land in `<server folder>\graftkit\reports`.
