// Organisations: everyone belongs to one or more, each with its owners, admins and members, and
// people are invited to one by email (see server/accounts/orgs/).

/** What someone is in an organisation. Only labels for now: nothing in the office is held back by them yet, beyond managing the organisation itself. */
export type OrgRole = 'owner' | 'admin' | 'member';

export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member'];

/** One of the organisations you're in, as the switcher lists it. */
export interface OrgSummary {
  id: string;
  name: string;
  /** Your role in it. */
  role: OrgRole;
  members: number;
}

export interface OrgMember {
  accountId: string;
  name: string;
  role: OrgRole;
  joinedAt: number;
  /** In the office right now. */
  online: boolean;
}

/** An invite to an organisation, sent by email. The link itself is only ever shown to whoever just made or re-sent it. */
export interface OrgInviteInfo {
  id: string;
  email: string;
  role: OrgRole;
  /** The name of whoever made it. */
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  /** When the email last went out (missing when it never did). */
  sentAt?: number;
  /** How many times it was sent. */
  sends: number;
  /** Why the last email didn't go out. */
  error?: string;
}

/** The organisation you're working in, in full. */
export interface OrgDetail {
  id: string;
  name: string;
  role: OrgRole;
  createdAt: number;
  members: OrgMember[];
  /** Open invites: only owners and admins see them. */
  invites: OrgInviteInfo[];
}

export interface OrgsState {
  orgs: OrgSummary[];
  /** The one you're working in. */
  active: OrgDetail;
  /** Whether the office can email invites (it has a Resend key); without one, invites are links to copy. */
  email: boolean;
}

export type OrgsClientMsg =
  | { t: 'orgs.get' }
  | { t: 'orgs.create'; name: string }
  | { t: 'orgs.switch'; orgId: string }
  | { t: 'orgs.rename'; orgId: string; name: string }
  | { t: 'orgs.delete'; orgId: string }
  | { t: 'orgs.leave'; orgId: string }
  /** `origin` is the page's own address, for the link in the email when the office has no public URL set. */
  | { t: 'orgs.invite'; orgId: string; email: string; role: OrgRole; origin?: string }
  /** Sends the invite again, with a fresh link (the old one stops working) and a fresh week. */
  | { t: 'orgs.resend'; orgId: string; inviteId: string; origin?: string }
  | { t: 'orgs.revoke'; orgId: string; inviteId: string }
  | { t: 'orgs.role'; orgId: string; accountId: string; role: OrgRole }
  | { t: 'orgs.remove'; orgId: string; accountId: string };

export type OrgsServerMsg =
  /** Your organisations: when asked, and whenever one of them changes. */
  | { t: 'orgs'; state: OrgsState }
  /** Sent to whoever made or re-sent an invite: its link, whether the email went out, or what went wrong. */
  | { t: 'orgs.invited'; orgId: string; email?: string; link?: string; emailed?: boolean; error?: string };
