// Every action, by the name `graftkit <action>` and the dashboard's toolkit know it.
import type { Action } from './util.ts';
import { house } from './house.ts';
import { village } from './village.ts';
import { army, pets } from './pets.ts';
import * as player from './player.ts';

export const ACTIONS: Record<string, Action> = { house, village, army, pets, status: player.status, immortal: player.immortal, gear: player.gear, raid: player.raid, title: player.title, cmd: player.cmd };
