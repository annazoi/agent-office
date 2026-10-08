// The building's floors: riding the elevator between them and up to the roof, and adding and taking
// off floors.
import type { FloorClientMsg } from '../../../shared/protocol.js';
import { ROOF } from '../../../shared/building/rooftop.js';
import { arrivalSpot, str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const projectView: ViewPieces['project'] = (_ctx, floor) => floor?.project ?? null;

export const floorHandlers = {
  'floor.go'(ctx, c, msg) {
    if (msg.floor === ROOF) {
      if (ctx.floors.size) ctx.goToRoof(c);
      else ctx.warn(c, 'There is no building to go up on yet');
      return;
    }
    const id = str(msg.floor, 64);
    const found = ctx.floors.get(id);
    const floor = found && ctx.sees(c, found.def) ? found : undefined;
    if (!floor) ctx.warn(c, ctx.building.pending().some((d) => d.id === id && ctx.sees(c, d)) ? "That floor is still being cloned — it'll be ready in a moment" : 'No such floor');
    else ctx.goToFloor(c, floor, arrivalSpot(msg.at));
  },
  'floor.repos'(ctx, c, msg) {
    void ctx.building.repos(msg.refresh === true, c.accountId).then(
      (repos) => ctx.sendTo(c, { t: 'floor.repos', repos }),
      (err: Error) => ctx.sendTo(c, { t: 'floor.repos', repos: [], error: err.message }),
    );
  },
  'floor.add'(ctx, c, msg) {
    const who = c.peer.name;
    const repo = str(msg.repo, 200);
    void ctx.building
      .add(
        repo,
        who,
        (def) => {
          ctx.floorsChanged();
          ctx.toastSeers(def, `🛗 ${who} is adding a floor for ${def.repo ?? def.name}…`);
        },
        c.accountId,
      )
      .then((r) => {
        ctx.floorsChanged();
        if (typeof r === 'string') return ctx.sendTo(c, { t: 'floor.added', repo, error: r });
        const floor = ctx.openFloor(r);
        if (!floor) return ctx.sendTo(c, { t: 'floor.added', repo, error: `Cloned ${r.repo}, but couldn't open its floor — see the office's log` });
        console.log(`  ${who} added a floor for ${r.repo} (${r.dir})`);
        ctx.toastSeers(r, `🛗 New floor: ${r.name}, added by ${who}`);
        ctx.sendTo(c, { t: 'floor.added', repo, floor: floor.id });
      });
  },
  'floor.cancel'(ctx, c, msg) {
    const who = c.peer.name;
    const admin = ctx.meOf(c.accountId).admin;
    const id = str(msg.floor, 64);
    const def = ctx.building.pending().find((d) => d.id === id);
    const err = ctx.building.cancel(id, `${who} stopped the clone`, (owner) => admin || (!!owner && owner === c.accountId));
    if (err) ctx.warn(c, err);
    else ctx.toastAll(`🛗 ${who} stopped cloning ${def?.repo ?? def?.name ?? 'a floor'}`);
  },
  'floor.remove'(ctx, c, msg) {
    const who = c.peer.name;
    const id = str(msg.floor, 64);
    // Everyone's workers on it stop: admins do it, or whoever added it, while it's still theirs alone.
    const def = ctx.floors.get(id)?.def;
    const admin = ctx.meOf(c.accountId).admin;
    if (!admin && !(def?.owner && def.owner === c.accountId && !def.shared)) return ctx.warn(c, def?.owner === c.accountId ? 'Only admins can take a shared floor off the building (stop sharing it first)' : 'Only admins, or whoever added it, can take a floor off the building');
    const r = ctx.building.remove(id, who);
    if (typeof r === 'string') return ctx.warn(c, r);
    console.log(`  ${who} took the ${r.name} floor off the building (${r.dir} stays where it is)`);
    const floor = ctx.floors.get(id);
    if (floor) ctx.closeFloor(floor, who);
    else ctx.floorsChanged();
  },
  'floor.share'(ctx, c, msg) {
    const who = c.peer.name;
    const r = ctx.building.share(str(msg.floor, 64), msg.shared === true, c.accountId, ctx.meOf(c.accountId).admin);
    if (typeof r === 'string') return ctx.warn(c, r);
    const floor = ctx.floors.get(r.id);
    // Kept to its owner again: whoever can't see it any more rides to a floor they can.
    if (!r.shared && floor) {
      for (const o of ctx.clients.values()) {
        if (o.peer.floor !== floor.id || ctx.sees(o, r)) continue;
        const next = ctx.arrivalFloor(null, o);
        if (next) ctx.goToFloor(o, next);
        else ctx.toLobby(o);
        ctx.sendTo(o, { t: 'toast', text: `🛗 ${who} stopped sharing ${r.name}, so you rode the elevator ${next ? `to ${next.def.name}` : 'down to the lobby'}`, level: 'warn' });
      }
    }
    ctx.floorsChanged();
    ctx.toastSeers(r, r.shared ? `🛗 ${who} shared ${r.name} with everyone` : `🛗 ${who} stopped sharing ${r.name}`);
  },
  'floor.projectsDir'(ctx, c, msg) {
    const who = c.peer.name;
    // It's a folder on the office's machine that `gh` writes into: admins pick it.
    const err = ctx.meOf(c.accountId).admin ? ctx.building.setProjectsDir(str(msg.dir, 1024), who) : 'Only admins can move the workspace folder';
    ctx.warn(c, err);
    if (err) return;
    const state = ctx.building.projectsDirState();
    ctx.broadcast({ t: 'projectsDir', state });
    ctx.toastAll(state.custom ? `📁 ${who} moved the workspace folder to ${state.dir}` : `📁 ${who} put the workspace folder back to ${state.dir}`);
  },
} satisfies HandlerMap<FloorClientMsg>;
