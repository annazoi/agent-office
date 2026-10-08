import path from 'node:path';
import type { Config } from '../config.js';
import { Auth } from '../accounts/auth.js';
import { Accounts } from '../accounts/accounts.js';
import { postgresStore } from '../accounts/store.js';
import { providerCommand } from '../agents/agents.js';
import type { AgentProvider } from '../../shared/providers.js';
import { createModelCatalogues } from '../agents/models.js';
import { Building } from '../floor/building.js';
import type { Floor } from '../floor/floor.js';
import { ChatLog } from '../floor/history.js';
import { Arcade, HighScores } from '../floor/cabinet.js';
import { scoreText } from '../../shared/cabinet.js';
import { cabinetChanged } from '../ws/handlers/cabinet.js';
import type { Core, Ctx } from './context.js';
import type { Client } from './client.js';

/** The first of the office: accounts and sign-in, the people in it, chat, the arcade, and the building's floors. */
export async function createCore(ctx: Ctx, cfg: Config, publicDir: string): Promise<Core> {
  const accounts = new Accounts(cfg.dataDir, cfg.databaseUrl ? postgresStore(cfg.databaseUrl) : undefined);
  await accounts.whenReady();
  const auth = new Auth(cfg.verifier, cfg.salt, cfg.secret, accounts);
  const clients = new Map<string, Client>();
  // Kept on disk, so a restart doesn't wipe it.
  const chat = new ChatLog(cfg.dataDir);
  // The arcade's high scores: one table for the whole building, on every floor's cabinet. The office
  // follows every game and puts the scores up itself (see Arcade).
  const highScores = new HighScores(cfg.dataDir);
  const arcade = new Arcade(highScores, (first) => {
    for (const f of ctx.floors.values()) cabinetChanged(ctx, f);
    if (first) ctx.toastFloor(ctx.floors.get(first.floor), `🏆 ${first.score.name} set a new arcade high score: ${scoreText(first.score.score)}`);
  });
  /** What the office is called where it has no project of its own to go by (webhooks, invites). */
  const officeName = cfg.project ? path.basename(cfg.project) : 'the office';
  // The model lists come from the provider's own CLI: the office's --agent when it's that one.
  const cli = (provider: AgentProvider) => {
    const command = providerCommand(provider, cfg.agentCmd);
    return command.includes('/') ? path.resolve(command) : command;
  };
  const models = createModelCatalogues(cli, cfg.dir);

  // --- The building: a floor per project, each with its own workers, boards and queue -----------
  const building = new Building(cfg.dataDir, cfg.projectsDir);
  if (cfg.projects) {
    const err = building.setProjectsDir(cfg.projects, 'the command line');
    if (err) console.error(`agent-office: --projects: ${err}`);
  }
  const floors = new Map<string, Floor>();
  return { cfg, publicDir, accounts, auth, clients, chat, highScores, arcade, officeName, models, building, floors };
}
