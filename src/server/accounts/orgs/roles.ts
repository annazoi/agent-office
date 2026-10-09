// What each role in an organisation may do. Roles hold nothing in the office back yet: these are only
// the rules for managing the organisation itself, kept in one place for when they do.
import { ORG_ROLES, type OrgRole } from '../../../shared/protocol.js';

export const ORG_NAME_MAX = 48;
const EMAIL_MAX = 254;

/** A role from the wire, or undefined. */
export const asRole = (v: unknown): OrgRole | undefined => (ORG_ROLES.includes(v as OrgRole) ? (v as OrgRole) : undefined);

/** Your role from your membership; no membership is the least of them. */
export const roleOf = (m: { role: OrgRole } | undefined): OrgRole => m?.role ?? 'member';

/** May invite people, resend and revoke invites, rename it and change roles. */
export const canManage = (role: OrgRole) => role === 'owner' || role === 'admin';

/** Whether someone with role `mine` may turn a `from` into a `to`: why not, or undefined. */
export function canSetRole(mine: OrgRole, from: OrgRole, to: OrgRole): string | undefined {
  if (!canManage(mine)) return 'Only owners and admins can change roles';
  if ((from === 'owner' || to === 'owner') && mine !== 'owner') return 'Only owners can make or unmake an owner';
  return undefined;
}

/** Collapses whitespace and drops control characters. */
export function cleanOrgName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ORG_NAME_MAX)
    .trim();
}

/** An email address, lower-cased, or '' when it isn't one. */
export function cleanEmail(v: unknown): string {
  if (typeof v !== 'string') return '';
  const e = v.trim().toLowerCase();
  if (e.length > EMAIL_MAX || /[\s<>,;"]/.test(e)) return '';
  return /^[^@]+@[^@]+\.[^@.]+$/.test(e) ? e : '';
}
