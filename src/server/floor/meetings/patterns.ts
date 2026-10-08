import path from 'node:path';
import { MEETING_PATTERNS, slugify } from '../../../shared/meetings.js';
import type { Meeting } from '../../../shared/protocol.js';
import type { PromptId, PromptVars } from '../../../shared/prompts.js';
import type { Part } from './types.js';
import { list } from './util.js';

/** What the patterns need from the room: where its files are, and the office's prompts. */
export interface PatternEnv {
  cwd(m: Meeting): string;
  say(id: PromptId, vars?: PromptVars): string;
}

/** What every worker is told when it sits down, ahead of its first part. */
export function brief(env: PatternEnv, m: Meeting, i: number): string {
  const p = MEETING_PATTERNS[m.pattern];
  const role = m.seats[i].role;
  const others = m.seats.filter((_, j) => j !== i).map((s) => `the ${s.role}`);
  const head = m.seats[0].role;
  const how: Record<Meeting['pattern'], string> = {
    debate: `Round 1: everyone proposes an answer. Each round after that until the last: everyone reads the others' latest notes, critiques them and revises their own. Last round: the ${head} writes the decision.`,
    lead: `Round 1: the ${head} splits the task into a part for each of the others and writes the plan. Round 2: each of them does their part. Round 3: the ${head} merges the work, checks it and writes it up.`,
    mapreduce: `Round 1: each mapper does the task over its own parts. Round 2: the ${head} combines what they found into one result.`,
    redblue: `Each round the Red team attacks the change (bugs, security holes, edge cases) and the Blue team fixes what holds up. The ${head} writes it all up in the last round, which comes early if Red finds nothing more.`,
    review: `Round 1: each reviewer reviews the pull request through their own lens. Round 2: the ${head} merges the reviews into one, which the office posts on the pull request.`,
  };
  const where = !m.worktree
    ? `You're in the project's folder, which other people use too: don't commit, push or switch branches.`
    : m.pattern === 'review'
      ? `This is a review: don't change, commit or push anything in the checkout. The only files you write are your notes${i === 0 ? ` and ${m.output}` : ''}.`
      : `You all share one git worktree, on the branch ${m.worktree.branch}. Don't commit, push or switch branches: when the meeting is over, the office commits ${m.output}, with whatever else was changed, there.`;
  // The worktree sits inside the project's own folder, where a search can wander off to.
  const inside = m.worktree ? ` The whole project is checked out in your working directory: read and write files there, by paths inside it, and never in a folder above it.` : '';
  return env.say('meeting.brief', {
    title: m.title,
    role,
    pattern: p.label,
    others: list(others),
    how: how[m.pattern],
    about: m.prompt,
    pullRequest: m.pr !== undefined ? `The pull request is #${m.pr}: read it with gh pr view ${m.pr} and gh pr diff ${m.pr}.` : '',
    issue: m.issue !== undefined ? `It comes from GitHub issue #${m.issue}: gh issue view ${m.issue} --comments.` : '',
    cwd: env.cwd(m),
    notes: path.join(env.cwd(m), m.notes),
    output: m.output,
    outputPath: path.join(env.cwd(m), m.output),
    rounds: `${m.rounds} round${m.rounds === 1 ? '' : 's'}`,
    where: where + inside,
  });
}

/** Whether `round` is the one that ends the meeting. */
export function isLast(m: Meeting, round: number): boolean {
  return round >= m.rounds || m.lastRound === round;
}

/** The parts of step `step` of round `round`, or null when that round has no such step. */
export function plan(env: PatternEnv, m: Meeting, round: number, step: number): Part[] | null {
  const n = m.seats.length;
  // Parts name their files by full path: a worktree sits inside the project's own folder, and an
  // agent can take a relative path to be the project's (and then it's asked about writing outside).
  const A = (rel: string) => path.join(env.cwd(m), rel);
  const note = (r: number, i: number) => `${m.notes}/r${r}-${i + 1}-${slugify(m.seats[i].role, 24)}.md`;
  const notes = (r: number, seats: number[]) => seats.map((i) => A(note(r, i))).join(', ');
  const all = m.seats.map((_, i) => i);
  const last = isLast(m, round);
  switch (m.pattern) {
    case 'debate': {
      if (step > 1) return null;
      if (last) {
        return [{ seat: 0, doing: 'writing the decision', file: m.output, ask: env.say('meeting.debate.decide', { notes: A(m.notes), lastNotes: notes(round - 1, all), output: A(m.output) }) }];
      }
      if (round === 1) return all.map((i) => ({ seat: i, doing: 'proposing', file: note(1, i), ask: env.say('meeting.debate.propose', { role: m.seats[i].role, file: A(note(1, i)) }) }));
      return all.map((i) => ({
        seat: i,
        doing: 'critiquing',
        file: note(round, i),
        ask: env.say('meeting.debate.critique', { previousRound: round - 1, theirNotes: notes(round - 1, all.filter((j) => j !== i)), file: A(note(round, i)) }),
      }));
    }
    case 'lead': {
      const team = all.slice(1);
      if (step > 1) return null;
      const plan = `${m.notes}/plan.md`;
      if (round === 1) {
        const parts = `${team.length} part${team.length === 1 ? '' : 's'}`;
        return [{ seat: 0, doing: 'planning', file: plan, ask: env.say('meeting.lead.plan', { parts, team: list(team.map((i) => `the ${m.seats[i].role}`)), exampleRole: m.seats[team[0]].role, file: A(plan) }) }];
      }
      if (round === 2) {
        return team.map((i) => ({ seat: i, doing: 'doing their part', file: note(2, i), ask: env.say('meeting.lead.part', { plan: A(plan), role: m.seats[i].role, lead: m.seats[0].role, file: A(note(2, i)) }) }));
      }
      return [{ seat: 0, doing: 'merging the work', file: m.output, ask: env.say('meeting.lead.merge', { reports: notes(2, team), output: A(m.output) }) }];
    }
    case 'mapreduce': {
      if (step > 1) return null;
      const mappers = all.slice(1);
      if (round === 1) {
        return mappers.map((i, k) => {
          const mine = (m.parts ?? []).filter((_, j) => j % mappers.length === k);
          return { seat: i, doing: 'mapping', file: note(1, i), ask: env.say('meeting.mapreduce.map', { parts: mine.map((x) => `- ${x}`).join('\n'), file: A(note(1, i)) }) };
        });
      }
      return [{ seat: 0, doing: 'reducing', file: m.output, ask: env.say('meeting.mapreduce.reduce', { results: notes(1, mappers), output: A(m.output) }) }];
    }
    case 'redblue': {
      const [blue, red] = [0, 1];
      const redNote = `${m.notes}/r${round}-red.md`;
      const blueNote = `${m.notes}/r${round}-blue.md`;
      if (step === 1) {
        const before = round > 1 ? ` The Blue team's fixes from round ${round - 1} are in ${A(`${m.notes}/r${round - 1}-blue.md`)}: check them first, then keep looking.` : '';
        return [{ seat: red, doing: 'attacking', file: redNote, ask: env.say('meeting.redblue.attack', { previousFixes: before, file: A(redNote) }) }];
      }
      if (step > 2) return null;
      if (m.lastRound === round) {
        return [{ seat: blue, doing: 'writing it up', file: m.output, ask: env.say('meeting.redblue.writeup', { findings: A(redNote), notes: A(m.notes), output: A(m.output) }) }];
      }
      const wrap = last ? ` This is the last round: once you've fixed things, also write ${A(m.output)}: every finding from every round (${A(m.notes)}/), what was fixed and how, and what's still open. That file is the meeting's output.` : '';
      return [{ seat: blue, doing: last ? 'fixing and writing it up' : 'fixing', file: last ? m.output : blueNote, ask: env.say('meeting.redblue.fix', { findings: A(redNote), file: A(blueNote), lastRound: wrap, output: A(m.output) }) }];
    }
    case 'review': {
      if (step > 1) return null;
      if (round === 1) {
        return all.map((i) => ({
          seat: i,
          doing: 'reviewing',
          file: note(1, i),
          ask: env.say('meeting.review.review', { pr: m.pr, role: m.seats[i].role, file: A(note(1, i)) }),
        }));
      }
      return [{ seat: 0, doing: 'writing the review', file: m.output, ask: env.say('meeting.review.combine', { findings: notes(1, all), exampleRole: m.seats[1]?.role ?? 'Security', output: A(m.output) }) }];
    }
  }
}
