// Emailing organisation invites, through Resend's API (https://resend.com/docs/api-reference/emails/send-email).
// The key comes from the server's environment only: RESEND_API_KEY. Without one the office still
// makes invites, and whoever sends one copies its link instead.
import type { OrgRole } from '../../../shared/protocol.js';

const RESEND_URL = 'https://api.resend.com/emails';
/** Resend's own sender, which only delivers to the Resend account's own address: fine to try it out, not for a team. */
const DEFAULT_FROM = 'Agent Office <onboarding@resend.dev>';
const TIMEOUT_MS = 10_000;

export interface InviteEmail {
  to: string;
  org: string;
  inviter: string;
  role: OrgRole;
  link: string;
  expiresAt: number;
}

export interface Mailer {
  /** Whether emails can go out at all. */
  readonly enabled: boolean;
  /** Sends an invite: undefined once it's sent, else why it wasn't. */
  sendInvite(mail: InviteEmail): Promise<string | undefined>;
}

export interface MailerOptions {
  apiKey?: string;
  from?: string;
  fetch?: typeof fetch;
}

/** The mailer the environment sets up: RESEND_API_KEY and, for the sender, AGENT_OFFICE_EMAIL_FROM (or RESEND_FROM). */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  return resendMailer({
    apiKey: (env.RESEND_API_KEY || env.AGENT_OFFICE_RESEND_API_KEY || '').trim() || undefined,
    from: (env.AGENT_OFFICE_EMAIL_FROM || env.RESEND_FROM || '').trim() || undefined,
  });
}

export function resendMailer(opts: MailerOptions): Mailer {
  const { apiKey } = opts;
  const from = opts.from ?? DEFAULT_FROM;
  const post = opts.fetch ?? fetch;
  return {
    enabled: !!apiKey,
    async sendInvite(mail) {
      if (!apiKey) return 'The office has no RESEND_API_KEY, so it can’t send email: copy the link below and send it yourself';
      const { subject, html, text } = inviteEmail(mail);
      try {
        const res = await post(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [mail.to], subject, html, text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return undefined;
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        return `The email didn't go out: ${body.message ?? `Resend answered ${res.status}`}`;
      } catch (err) {
        return `The email didn't go out: ${(err as Error).message}`;
      }
    },
  };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The invite's subject and body, as HTML and as plain text. */
export function inviteEmail(mail: InviteEmail): { subject: string; html: string; text: string } {
  const days = Math.max(1, Math.round((mail.expiresAt - Date.now()) / 86_400_000));
  const as = mail.role === 'member' ? 'a member' : `an ${mail.role}`;
  const subject = `${mail.inviter} invited you to ${mail.org} on Agent Office`;
  const text = `${mail.inviter} invited you to join ${mail.org} on Agent Office as ${as}.\n\nAccept the invite:\n${mail.link}\n\nThe link works once and expires in ${days} day${days === 1 ? '' : 's'}. If you weren't expecting it, ignore this email.\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#222">
<h2 style="margin:0 0 12px">You're invited to ${escape(mail.org)}</h2>
<p>${escape(mail.inviter)} invited you to join <b>${escape(mail.org)}</b> on Agent Office as ${as}.</p>
<p style="margin:24px 0"><a href="${escape(mail.link)}" style="background:#ff8a5b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Accept the invite</a></p>
<p style="color:#666;font-size:13px">Or open this link: <br><a href="${escape(mail.link)}">${escape(mail.link)}</a></p>
<p style="color:#666;font-size:13px">It works once and expires in ${days} day${days === 1 ? '' : 's'}. If you weren't expecting it, ignore this email.</p>
</div>`;
  return { subject, html, text };
}

/**
 * Where an invite link points: the office's public address (AGENT_OFFICE_PUBLIC_URL) when it has one,
 * else the address of the page the invite was sent from. The token rides in the fragment, so it
 * never reaches a server log.
 */
export function inviteLink(token: string, origin: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = (env.AGENT_OFFICE_PUBLIC_URL || '').trim() || origin;
  if (!base) return undefined;
  try {
    const u = new URL(base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return `${u.origin}/invite#${token}`;
  } catch {
    return undefined;
  }
}
