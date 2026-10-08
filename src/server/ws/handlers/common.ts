// Lookups most handlers start with.
import type { Floor } from '../../floor/floor.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';

/** The floor `c` is on; when they're on none, their page offers to add a project (or ride to one). */
export const here = (ctx: Ctx, c: Client): Floor | undefined => {
  const f = ctx.floorOf(c);
  if (!f) ctx.sendTo(c, { t: 'floor.needed', why: ctx.floors.size ? 'That happens on a project: ride the elevator to one of your floors, or add one of your repositories.' : 'That needs a project. Add one of your repositories as a floor first: the office clones it, and its desks, boards and queue are its own.' });
  return f;
};

/** A worker by id, with the floor it sits on. */
export const workerOf = (ctx: Ctx, id: unknown) => {
  const wid = str(id, 32);
  const floor = ctx.workerFloor(wid);
  return floor ? { wid, floor, info: floor.workers.get(wid)! } : undefined;
};
