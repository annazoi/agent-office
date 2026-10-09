import './orgs.css';
import type { OrgInviteInfo, OrgRole, OrgsState, ServerMsg } from '../../shared/protocol';
import type { Net } from '../shared/net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';

const canManage = (role: OrgRole) => role === 'owner' || role === 'admin';
const ROLE_LABEL: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

function roleSelect(mine: OrgRole, value: OrgRole, label: string): HTMLSelectElement {
  // Only owners make owners.
  const roles: OrgRole[] = mine === 'owner' ? ['member', 'admin', 'owner'] : ['member', 'admin'];
  const sel = h('select', { 'aria-label': label }, ...roles.map((r) => h('option', { value: r }, ROLE_LABEL[r]))) as HTMLSelectElement;
  sel.value = value;
  return sel;
}

function inviteStatus(v: OrgInviteInfo): string {
  if (v.expiresAt <= Date.now()) return 'expired: send it again';
  if (v.error) return v.sentAt ? `sent ${timeAgo(v.sentAt)}, the last try failed` : 'not emailed';
  if (v.sentAt) return `sent ${timeAgo(v.sentAt)}${v.sends > 1 ? ` (${v.sends}×)` : ''}`;
  return 'sending…';
}

let onInvited: ((msg: Extract<ServerMsg, { t: 'orgs.invited' }>) => void) | null = null;

export function routeOrgsMessage(msg: ServerMsg) {
  if (msg.t === 'orgs.invited') onInvited?.(msg);
}

/** 🏢 Organisations: switch between yours, make one, and invite people to it by email. */
export function openOrgs(net: Net) {
  /** The link of the invite just sent, to copy, until the next one. */
  let fresh: { email: string; link: string } | null = null;
  let status: HTMLElement | null = null;

  const body = h('div.body.team.orgs');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal', { role: 'dialog', 'aria-label': 'Organisations', style: 'width:min(720px,100%)' }, h('header', {}, h('h2', {}, '🏢 Organisations'), close), body);

  // The forms are made once, so what's typed in them survives each re-render.
  const picker = h('select', { 'aria-label': 'Organisation you work in' }) as HTMLSelectElement;
  picker.addEventListener('change', () => net.send({ t: 'orgs.switch', orgId: picker.value }));
  const newName = h('input', { type: 'text', maxlength: 48, placeholder: 'New organisation’s name', 'aria-label': 'New organisation’s name', autocomplete: 'off' }) as HTMLInputElement;
  const createForm = h('form.invite-row', {}, newName, h('button.btn', { type: 'submit' }, 'Create')) as HTMLFormElement;
  createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!newName.value.trim()) return newName.focus();
    net.send({ t: 'orgs.create', name: newName.value.trim() });
    newName.value = '';
  });

  const renameInput = h('input', { type: 'text', maxlength: 48, 'aria-label': 'Organisation name', autocomplete: 'off' }) as HTMLInputElement;
  const renameForm = h('form.invite-row', {}, renameInput, h('button.btn', { type: 'submit' }, 'Rename')) as HTMLFormElement;
  renameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = store.orgs;
    if (s && renameInput.value.trim() && renameInput.value.trim() !== s.active.name) net.send({ t: 'orgs.rename', orgId: s.active.id, name: renameInput.value.trim() });
  });

  const email = h('input', { type: 'text', inputmode: 'email', maxlength: 254, placeholder: 'their@email.com', 'aria-label': 'Their email', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  let inviteRole = roleSelect('admin', 'member', 'Their role');
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, 'Send invite');
  const inviteForm = h('form.invite-row', {}) as HTMLFormElement;
  inviteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = store.orgs;
    if (!s || !email.value.trim()) return email.focus();
    inviteBtn.disabled = true;
    net.send({ t: 'orgs.invite', orgId: s.active.id, email: email.value.trim(), role: inviteRole.value as OrgRole, origin: location.origin });
  });

  const render = () => {
    const s: OrgsState | null = store.orgs;
    const focused = document.activeElement;
    body.replaceChildren();
    if (!s) return body.append(h('p.empty', {}, 'Loading…'));
    const org = s.active;
    const manager = canManage(org.role);

    // Which one you're working in, and making another.
    picker.replaceChildren(...s.orgs.map((o) => h('option', { value: o.id }, `${o.name} · ${ROLE_LABEL[o.role].toLowerCase()} · ${o.members} ${o.members === 1 ? 'person' : 'people'}`)));
    picker.value = org.id;
    body.append(h('label', {}, 'Working in'), h('div.invite-row', {}, picker), h('label', {}, 'Make a new one'), createForm);

    body.append(h('div.team-head', {}, h('h4', {}, org.name, ' ', h('span.role', { class: org.role }, org.role))));
    if (manager) {
      if (focused !== renameInput) renameInput.value = org.name;
      body.append(renameForm);
    }

    // Its people.
    const list = h('ul.team-list');
    for (const m of org.members) {
      const you = m.name === store.me.account?.name;
      const row = h('li', {}, h('span.dot', { class: m.online ? 'on' : '', title: m.online ? 'In the office' : 'Away' }), h('span.name', {}, m.name, you ? h('span.you', {}, ' (you)') : null));
      // Owners are only changed by owners.
      if (manager && !you && (org.role === 'owner' || m.role !== 'owner')) {
        const sel = roleSelect(org.role, m.role, `${m.name}'s role`);
        sel.addEventListener('change', () => net.send({ t: 'orgs.role', orgId: org.id, accountId: m.accountId, role: sel.value as OrgRole }));
        const remove = h('button.btn.danger', { type: 'button', title: `Take ${m.name} out of ${org.name}` }, 'Remove');
        remove.addEventListener('click', () =>
          confirmDialog(`Remove ${m.name}?`, `They're no longer in ${org.name}. Their account stays, with the rest of their organisations.`, 'Remove', () =>
            net.send({ t: 'orgs.remove', orgId: org.id, accountId: m.accountId }),
          ),
        );
        row.append(sel, h('span.keys', {}, `joined ${timeAgo(m.joinedAt)}`), remove);
      } else row.append(h('span.role', { class: m.role }, m.role), h('span.keys', {}, `joined ${timeAgo(m.joinedAt)}`));
      list.append(row);
    }
    body.append(h('h4', {}, 'People ', h('span.count', {}, String(org.members.length))), list);

    // Inviting people, for owners and admins.
    if (manager) {
      const keep = inviteRole.value as OrgRole;
      inviteRole = roleSelect(org.role, keep === 'owner' && org.role !== 'owner' ? 'member' : keep, 'Their role');
      inviteForm.replaceChildren(email, inviteRole, inviteBtn);
      body.append(
        h('h4', {}, 'Invite someone'),
        inviteForm,
        h(
          'p.note',
          {},
          s.email
            ? 'They get an email with a link that works once and expires after 7 days. Sending it again makes a new link.'
            : 'The office has no RESEND_API_KEY, so it can’t send email: copy the link it makes and send it yourself. It works once and expires after 7 days.',
        ),
      );
      if (status) body.append(status);
      if (fresh) {
        const link = fresh.link;
        body.append(h('div.cmd', {}, h('pre', {}, link), copyButton('Copy', () => link)));
      }
      if (org.invites.length) {
        const invites = h('ul.team-list');
        for (const v of org.invites) {
          const resend = h('button.btn', { type: 'button', title: 'Email it again, with a new link and a new week' }, 'Resend');
          resend.addEventListener('click', () => {
            resend.disabled = true;
            net.send({ t: 'orgs.resend', orgId: org.id, inviteId: v.id, origin: location.origin });
          });
          const revoke = h('button.btn.danger', { type: 'button', title: 'Its link stops working' }, 'Revoke');
          revoke.addEventListener('click', () =>
            confirmDialog(`Revoke the invite to ${v.email}?`, 'Its link stops working right away.', 'Revoke', () => {
              if (fresh?.email === v.email) fresh = null;
              net.send({ t: 'orgs.revoke', orgId: org.id, inviteId: v.id });
            }),
          );
          invites.append(
            h(
              'li',
              { class: v.expiresAt <= Date.now() ? 'expired' : '' },
              h('span.name', { title: v.email }, v.email),
              h('span.role', { class: v.role }, v.role),
              h('span.keys', { title: v.error ?? `Invited by ${v.createdBy} ${timeAgo(v.createdAt)}` }, inviteStatus(v)),
              resend,
              revoke,
            ),
          );
        }
        body.append(h('h4', {}, 'Open invites ', h('span.count', {}, String(org.invites.length))), invites);
      }
    }

    // Leaving it, or deleting it.
    const leave = h('button.btn', { type: 'button' }, 'Leave');
    leave.addEventListener('click', () =>
      confirmDialog(`Leave ${org.name}?`, s.orgs.length > 1 ? 'You can only come back with a new invite.' : 'It’s your only one, so you get a new organisation of your own.', 'Leave', () =>
        net.send({ t: 'orgs.leave', orgId: org.id }),
      ),
    );
    const danger = h('div.org-danger', {}, leave);
    if (org.role === 'owner') {
      const del = h('button.btn.danger', { type: 'button' }, 'Delete organisation');
      del.addEventListener('click', () =>
        confirmDialog(`Delete ${org.name}?`, 'Everyone in it is taken out, and its open invites stop working. Their accounts stay.', 'Delete', () => net.send({ t: 'orgs.delete', orgId: org.id })),
      );
      danger.append(del);
    }
    body.append(danger);
    if (focused instanceof HTMLElement && body.contains(focused)) focused.focus();
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (!msg.email) {
      status = h('p.team-status.error', {}, msg.error ?? 'Could not make the invite');
      return render();
    }
    fresh = msg.link ? { email: msg.email, link: msg.link } : null;
    email.value = '';
    status = msg.emailed
      ? h('p.team-status.ok', {}, `✅ Invite emailed to ${msg.email}. The link is below too, if they'd rather have it from you.`)
      : h('p.team-status.error', {}, msg.error ?? 'The email didn’t go out');
    render();
  };
  const unsubs = [store.on('orgs', render), store.on('me', render)];
  const modal = openModal(el, {
    onClose: () => {
      unsubs.forEach((u) => u());
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'orgs.get' });
}
