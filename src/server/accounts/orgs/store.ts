// The office's organisations: who is in which, with what role, and the invites out to join them. One
// document in the office's database, like the accounts. Every account is in at least one: the
// migration below gives each account that has none an organisation of its own, and `ensure` does the
// same for anyone made since (registering, an invite link, `agent-office accounts`).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { stateDoc, type Doc } from '../../db/state.js';
import type { OrgDetail, OrgInviteInfo, OrgRole, OrgsState, OrgSummary } from '../../../shared/protocol.js';
import { canManage, canSetRole, cleanEmail, cleanOrgName, roleOf } from './roles.js';

/** The newest shape of the document; `migrate` brings an older one up to it. */
export const ORGS_VERSION = 1;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
/** An invite that ran out is kept this long, so it can still be re-sent, then dropped. */
const EXPIRED_KEPT_MS = 30 * 24 * 60 * 60_000;
/** The least time between two emails for one invite. */
export const RESEND_GAP_MS = 60_000;
const MAX_INVITES = 100;
const MAX_ORGS_PER_ACCOUNT = 50;

export interface Org {
  id: string;
  name: string;
  createdAt: number;
  /** The account that made it ('migration' for the ones the migration made). */
  createdBy: string;
}

export interface Membership {
  orgId: string;
  accountId: string;
  role: OrgRole;
  joinedAt: number;
}

export interface Invite {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  /** sha256 of the link's token, hex: the token itself is only in the email (and shown once to whoever sent it). */
  tokenHash: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  sentAt?: number;
  sends: number;
  error?: string;
}

export interface OrgsData {
  version: number;
  orgs: Org[];
  members: Membership[];
  invites: Invite[];
  /** The organisation each account is working in, by account id. */
  active: Record<string, string>;
}

/** Who an account is, as far as organisations need to know. */
export interface AccountRef {
  id: string;
  name: string;
}

/** Looks up accounts: what organisations know of them is only their id. */
export interface AccountLookup {
  get(id: string): AccountRef | undefined;
  all(): AccountRef[];
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const newId = () => randomBytes(8).toString('hex');
const empty = (): OrgsData => ({ version: ORGS_VERSION, orgs: [], members: [], invites: [], active: {} });
export const defaultOrgName = (name: string) => cleanOrgName(`${name}'s organisation`) || 'My organisation';

/**
 * Brings a saved document up to the newest shape, losing nothing: version 0 (no document yet, from
 * before there were organisations) becomes version 1, with an organisation for every account that
 * isn't in one, which they own and work in.
 */
export function migrate(saved: Partial<OrgsData> | undefined, accounts: AccountRef[], now = Date.now()): { data: OrgsData; changed: boolean } {
  const data: OrgsData = {
    version: typeof saved?.version === 'number' ? saved.version : 0,
    orgs: Array.isArray(saved?.orgs) ? saved.orgs.filter((o) => o && typeof o.id === 'string') : [],
    members: Array.isArray(saved?.members) ? saved.members.filter((m) => m && typeof m.orgId === 'string' && typeof m.accountId === 'string') : [],
    invites: Array.isArray(saved?.invites) ? saved.invites.filter((v) => v && typeof v.tokenHash === 'string') : [],
    active: saved?.active && typeof saved.active === 'object' ? { ...saved.active } : {},
  };
  let changed = data.version !== saved?.version;
  if (data.version < 1) {
    for (const a of accounts) if (seedDefault(data, a, 'migration', now)) changed = true;
    data.version = 1;
    changed = true;
  }
  return { data, changed };
}

/** Gives `account` an organisation of its own when it's in none; true when it did. */
function seedDefault(data: OrgsData, account: AccountRef, by: string, now: number): boolean {
  if (data.members.some((m) => m.accountId === account.id)) return false;
  const org: Org = { id: newId(), name: defaultOrgName(account.name), createdAt: now, createdBy: by };
  data.orgs.push(org);
  data.members.push({ orgId: org.id, accountId: account.id, role: 'owner', joinedAt: now });
  data.active[account.id] = org.id;
  return true;
}

export class Orgs {
  private data: OrgsData;
  private doc: Doc<Partial<OrgsData>>;

  constructor(
    dataDir: string,
    private accounts: AccountLookup,
  ) {
    this.doc = stateDoc(dataDir, 'organisations');
    const { data, changed } = migrate(this.doc.read(), accounts.all());
    this.data = data;
    if (changed) this.save();
    this.ensure();
  }

  /**
   * Squares the organisations with the accounts: every account is in one (a new one gets its own),
   * memberships of accounts that are gone go, and so do organisations nobody is left in.
   */
  ensure(now = Date.now()): boolean {
    let changed = false;
    const live = new Set(this.accounts.all().map((a) => a.id));
    const kept = this.data.members.filter((m) => live.has(m.accountId));
    if (kept.length !== this.data.members.length) {
      this.data.members = kept;
      changed = true;
    }
    for (const id of Object.keys(this.data.active)) {
      if (!live.has(id)) {
        delete this.data.active[id];
        changed = true;
      }
    }
    for (const org of [...this.data.orgs]) if (this.settle(org.id)) changed = true;
    for (const a of this.accounts.all()) if (seedDefault(this.data, a, a.id, now)) changed = true;
    const keep = this.data.invites.filter((v) => v.expiresAt + EXPIRED_KEPT_MS > now);
    if (keep.length !== this.data.invites.length) {
      this.data.invites = keep;
      changed = true;
    }
    if (changed) this.save();
    return changed;
  }

  get(orgId: string): Org | undefined {
    return this.data.orgs.find((o) => o.id === orgId);
  }

  membership(orgId: string, accountId: string | undefined): Membership | undefined {
    return accountId ? this.data.members.find((m) => m.orgId === orgId && m.accountId === accountId) : undefined;
  }

  /** The organisations `accountId` is in, oldest membership first. */
  orgsOf(accountId: string): Org[] {
    return this.data.members.filter((m) => m.accountId === accountId).map((m) => this.get(m.orgId)).filter((o): o is Org => !!o);
  }

  membersOf(orgId: string): Membership[] {
    return this.data.members.filter((m) => m.orgId === orgId);
  }

  /** The organisation `accountId` is working in: the one they picked, else their first. */
  activeOf(accountId: string): Org | undefined {
    const picked = this.data.active[accountId];
    if (picked && this.membership(picked, accountId)) return this.get(picked);
    return this.orgsOf(accountId)[0];
  }

  state(accountId: string, online: Set<string>, email: boolean): OrgsState | undefined {
    this.ensure();
    const active = this.activeOf(accountId);
    if (!active) return undefined;
    const orgs: OrgSummary[] = this.orgsOf(accountId).map((o) => ({ id: o.id, name: o.name, role: roleOf(this.membership(o.id, accountId)), members: this.membersOf(o.id).length }));
    const role = roleOf(this.membership(active.id, accountId));
    const name = (id: string) => this.accounts.get(id)?.name ?? 'someone';
    const detail: OrgDetail = {
      id: active.id,
      name: active.name,
      role,
      createdAt: active.createdAt,
      members: this.membersOf(active.id).map((m) => ({ accountId: m.accountId, name: name(m.accountId), role: m.role, joinedAt: m.joinedAt, online: online.has(m.accountId) })),
      invites: canManage(role) ? this.data.invites.filter((v) => v.orgId === active.id).map((v) => inviteInfo(v, name(v.createdBy))) : [],
    };
    return { orgs, active: detail, email };
  }

  // --- Organisations ------------------------------------------------------------------------------

  create(by: string, name: string): Org | string {
    const n = cleanOrgName(name);
    if (!n) return 'Give the organisation a name';
    if (this.orgsOf(by).length >= MAX_ORGS_PER_ACCOUNT) return `You're in ${MAX_ORGS_PER_ACCOUNT} organisations already`;
    const now = Date.now();
    const org: Org = { id: newId(), name: n, createdAt: now, createdBy: by };
    this.data.orgs.push(org);
    this.data.members.push({ orgId: org.id, accountId: by, role: 'owner', joinedAt: now });
    this.data.active[by] = org.id;
    this.save();
    return org;
  }

  switchTo(accountId: string, orgId: string): string | undefined {
    if (!this.membership(orgId, accountId)) return "You're not in that organisation";
    this.data.active[accountId] = orgId;
    this.save();
    return undefined;
  }

  rename(by: string, orgId: string, name: string): string | undefined {
    const org = this.get(orgId);
    if (!org || !canManage(roleOf(this.membership(orgId, by)))) return 'Only its owners and admins can rename it';
    const n = cleanOrgName(name);
    if (!n) return 'Give the organisation a name';
    org.name = n;
    this.save();
    return undefined;
  }

  /** Deletes an organisation (owners only); anyone it was the last one of gets one of their own again. */
  remove(by: string, orgId: string): string | undefined {
    if (roleOf(this.membership(orgId, by)) !== 'owner') return 'Only its owners can delete it';
    this.drop(orgId);
    this.ensure();
    this.save();
    return undefined;
  }

  leave(accountId: string, orgId: string): string | undefined {
    const m = this.membership(orgId, accountId);
    if (!m) return "You're not in that organisation";
    const others = this.membersOf(orgId).filter((x) => x.accountId !== accountId);
    if (m.role === 'owner' && others.length && !others.some((x) => x.role === 'owner')) return 'Make someone else an owner before you leave';
    this.data.members = this.data.members.filter((x) => x !== m);
    if (!others.length) this.drop(orgId);
    this.ensure();
    this.save();
    return undefined;
  }

  // --- Members ------------------------------------------------------------------------------------

  setRole(by: string, orgId: string, accountId: string, role: OrgRole): string | undefined {
    const target = this.membership(orgId, accountId);
    if (!target) return "They're not in that organisation";
    const err = canSetRole(roleOf(this.membership(orgId, by)), target.role, role);
    if (err) return err;
    if (target.role === 'owner' && role !== 'owner' && this.owners(orgId) === 1) return 'An organisation needs at least one owner';
    target.role = role;
    this.save();
    return undefined;
  }

  removeMember(by: string, orgId: string, accountId: string): string | undefined {
    if (by === accountId) return 'Leave the organisation instead';
    const target = this.membership(orgId, accountId);
    if (!target) return "They're not in that organisation";
    const mine = roleOf(this.membership(orgId, by));
    if (!canManage(mine)) return 'Only owners and admins can remove people';
    if (target.role === 'owner' && mine !== 'owner') return 'Only owners can remove an owner';
    this.data.members = this.data.members.filter((x) => x !== target);
    this.ensure();
    this.save();
    return undefined;
  }

  // --- Invites ------------------------------------------------------------------------------------

  /** Makes an invite for `email`: the invite, and the token for its link (kept nowhere else). */
  invite(by: string, orgId: string, email: string, role: OrgRole): { invite: Invite; token: string } | string {
    const mine = roleOf(this.membership(orgId, by));
    if (!this.get(orgId) || !canManage(mine)) return 'Only owners and admins can invite people';
    if (role === 'owner' && mine !== 'owner') return 'Only owners can invite an owner';
    const e = cleanEmail(email);
    if (!e) return "That doesn't look like an email address";
    const now = Date.now();
    if (this.data.invites.some((v) => v.orgId === orgId && v.email === e && v.expiresAt > now)) return `${e} has an open invite already: send it again instead`;
    if (this.data.invites.filter((v) => v.orgId === orgId).length >= MAX_INVITES) return 'Too many open invites: revoke some first';
    const token = randomBytes(24).toString('base64url');
    const invite: Invite = { id: newId(), orgId, email: e, role, tokenHash: tokenHash(token), createdBy: by, createdAt: now, expiresAt: now + INVITE_TTL_MS, sends: 0 };
    this.data.invites.push(invite);
    this.save();
    return { invite, token };
  }

  /** A fresh link (the old one stops working) and a fresh week for an invite, to send again. */
  reissue(by: string, orgId: string, inviteId: string): { invite: Invite; token: string } | string {
    if (!canManage(roleOf(this.membership(orgId, by)))) return 'Only owners and admins can resend invites';
    const invite = this.data.invites.find((v) => v.id === inviteId && v.orgId === orgId);
    if (!invite) return 'That invite was revoked or used already';
    const now = Date.now();
    if (invite.sentAt && now - invite.sentAt < RESEND_GAP_MS) return 'It was only just sent: give it a minute';
    const token = randomBytes(24).toString('base64url');
    invite.tokenHash = tokenHash(token);
    invite.expiresAt = now + INVITE_TTL_MS;
    this.save();
    return { invite, token };
  }

  /** Notes how sending an invite's email went. */
  sent(inviteId: string, error?: string) {
    const invite = this.data.invites.find((v) => v.id === inviteId);
    if (!invite) return;
    if (error) invite.error = error;
    else {
      delete invite.error;
      invite.sentAt = Date.now();
      invite.sends++;
    }
    this.save();
  }

  revokeInvite(by: string, orgId: string, inviteId: string): string | undefined {
    if (!canManage(roleOf(this.membership(orgId, by)))) return 'Only owners and admins can revoke invites';
    const before = this.data.invites.length;
    this.data.invites = this.data.invites.filter((v) => !(v.id === inviteId && v.orgId === orgId));
    if (before === this.data.invites.length) return undefined;
    this.save();
    return undefined;
  }

  /** The open invite a link's token is for. */
  findInvite(token: string): Invite | undefined {
    if (!token) return undefined;
    const want = Buffer.from(tokenHash(token), 'hex');
    const now = Date.now();
    return this.data.invites.find((v) => v.expiresAt > now && timingSafeEqual(Buffer.from(v.tokenHash, 'hex'), want));
  }

  /** Uses up an invite: `accountId` joins its organisation (and starts working in it). */
  accept(token: string, accountId: string): Org | string {
    const invite = this.findInvite(token);
    if (!invite) return 'This invite has expired, was revoked or was used already. Ask for a new one.';
    const org = this.get(invite.orgId);
    this.data.invites = this.data.invites.filter((v) => v !== invite);
    if (!org) {
      this.save();
      return 'That organisation is gone';
    }
    const m = this.membership(org.id, accountId);
    // Already in it: an invite never takes a role away.
    if (!m) this.data.members.push({ orgId: org.id, accountId, role: invite.role, joinedAt: Date.now() });
    else if (rank(invite.role) < rank(m.role)) m.role = invite.role;
    this.data.active[accountId] = org.id;
    this.save();
    return org;
  }

  private owners(orgId: string): number {
    return this.membersOf(orgId).filter((m) => m.role === 'owner').length;
  }

  /** An organisation whose owners all went: its longest-standing admin, else member, takes over. True when anything changed. */
  private settle(orgId: string): boolean {
    const members = this.membersOf(orgId);
    if (!members.length) {
      this.drop(orgId);
      return true;
    }
    if (members.some((m) => m.role === 'owner')) return false;
    const heir = [...members].sort((a, b) => rank(a.role) - rank(b.role) || a.joinedAt - b.joinedAt)[0];
    heir.role = 'owner';
    return true;
  }

  private drop(orgId: string) {
    this.data.orgs = this.data.orgs.filter((o) => o.id !== orgId);
    this.data.members = this.data.members.filter((m) => m.orgId !== orgId);
    this.data.invites = this.data.invites.filter((v) => v.orgId !== orgId);
    for (const [id, org] of Object.entries(this.data.active)) if (org === orgId) delete this.data.active[id];
  }

  private save() {
    this.doc.write(this.data);
  }
}

/** Owners first, then admins, then members. */
const rank = (role: OrgRole) => (role === 'owner' ? 0 : role === 'admin' ? 1 : 2);

function inviteInfo(v: Invite, createdBy: string): OrgInviteInfo {
  return {
    id: v.id,
    email: v.email,
    role: v.role,
    createdBy,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
    ...(v.sentAt ? { sentAt: v.sentAt } : {}),
    sends: v.sends,
    ...(v.error ? { error: v.error } : {}),
  };
}
