import './accounts.css';
import type { AccountInvite, AccountRole, ServerMsg } from '../../shared/protocol';
import type { Net } from '../shared/net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';

export const inviteLink = (v: AccountInvite) => `${location.origin}/join#${v.token}`;

function expiresIn(t: number): string {
  const d = Math.round((t - Date.now()) / 86_400_000);
  return d >= 1 ? `expires in ${d} day${d === 1 ? '' : 's'}` : 'expires today';
}

let onInvited: ((msg: Extract<ServerMsg, { t: 'accounts.invited' }>) => void) | null = null;

export function routeAccountsMessage(msg: ServerMsg) {
  if (msg.t === 'accounts.invited') onInvited?.(msg);
}

/** 🔑 Accounts, for admins: invite people by link, list them, change their role or revoke them. */
export function openAccounts(net: Net) {
  let status: HTMLElement | null = null;
  /** The invite just made, shown big until the next one. */
  let fresh: AccountInvite | null = null;
  const body = h('div.body.team.accounts');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const signedInAs = h('span.grow');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Accounts', style: 'width:min(680px,100%)' },
    h('header', {}, h('h2', {}, '🔑 Accounts'), close),
    body,
    h('footer', {}, signedInAs),
  );

  const nameInput = h('input', { type: 'text', maxlength: 24, placeholder: 'Their name (optional)', 'aria-label': 'Their name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const roleSelect = h('select', { 'aria-label': 'Role' }, h('option', { value: 'member' }, 'Member'), h('option', { value: 'admin' }, 'Admin')) as HTMLSelectElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, 'Make invite link');
  const form = h('form.invite-row', {}, nameInput, roleSelect, inviteBtn) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    inviteBtn.disabled = true;
    net.send({ t: 'accounts.invite', name: nameInput.value.trim() || undefined, role: roleSelect.value as AccountRole });
  });

  const render = () => {
    const s = store.accounts;
    const me = store.me;
    signedInAs.textContent = `You're signed in as ${me.account.name} (${me.account.role}).`;
    const typing = document.activeElement === nameInput;
    body.replaceChildren();
    if (!s) return body.append(h('p.empty', {}, 'Loading…'));

    body.append(
      h('label', {}, 'Invite someone'),
      form,
      h('p.note', {}, 'You get a link that makes one account, with its own name and password. It works once and expires after 7 days. Leave the name empty and they pick their own.'),
    );
    if (status) body.append(status);
    if (fresh) {
      const v = fresh;
      body.append(h('div.cmd', {}, h('pre', {}, inviteLink(v)), copyButton('Copy', () => inviteLink(v))));
    }
    if (store.invites) body.append(h('p.note', {}, 'On this office they also need a way in first: see 👥 Invite teammates.'));

    const list = h('ul.team-list');
    for (const a of s.accounts) {
      const you = me.account?.name === a.name;
      const seen = a.online ? 'in the office' : a.lastSeenAt ? `seen ${timeAgo(a.lastSeenAt)}` : 'never came in';
      const role = h('button.btn', { type: 'button', title: a.role === 'admin' ? 'Take away admin rights' : 'Let them manage accounts too' }, a.role === 'admin' ? 'Make member' : 'Make admin');
      role.addEventListener('click', () => net.send({ t: 'accounts.role', accountId: a.id, role: a.role === 'admin' ? 'member' : 'admin' }));
      const revoke = h('button.btn.danger', { type: 'button', title: `Delete ${a.name}'s account` }, 'Revoke');
      revoke.addEventListener('click', () =>
        confirmDialog(
          `Revoke ${a.name}?`,
          `Their account and everything it kept are deleted, and they're signed out everywhere right away. Terminals they typed in keep running. ${s.openRegistration ? `If ${a.name} knows the office password, they could register again: close registration below.` : ''}`,
          'Revoke',
          () => net.send({ t: 'accounts.revoke', accountId: a.id }),
        ),
      );
      list.append(
        h(
          'li',
          {},
          h('span.dot', { class: a.online ? 'on' : '', title: seen }),
          h('span.name', {}, a.name, you ? h('span.you', {}, ' (you)') : null),
          h('span.role', { class: a.role }, a.role),
          h('span.keys', { title: `Invited by ${a.createdBy}` }, seen),
          you ? null : role,
          you ? null : revoke,
        ),
      );
    }
    if (!s.accounts.length) list.append(h('li.empty', {}, 'Nobody has an account yet'));
    body.append(h('h4', {}, 'People ', h('span.count', {}, String(s.accounts.length))), list);

    if (s.invites.length) {
      const invites = h('ul.team-list');
      for (const v of s.invites) {
        const cancel = h('button.btn', { type: 'button', title: 'The link stops working' }, 'Cancel');
        cancel.addEventListener('click', () => {
          if (fresh?.id === v.id) fresh = null;
          net.send({ t: 'accounts.cancel', inviteId: v.id });
        });
        invites.append(
          h(
            'li',
            {},
            h('span.name', {}, v.name ?? h('i', {}, 'they pick a name')),
            h('span.role', { class: v.role }, v.role),
            h('span.keys', { title: `Made by ${v.createdBy} ${timeAgo(v.createdAt)}` }, expiresIn(v.expiresAt)),
            copyButton('Copy link', () => inviteLink(v)),
            cancel,
          ),
        );
      }
      body.append(h('h4', {}, 'Open invites ', h('span.count', {}, String(s.invites.length))), invites);
    }

    // Registering: anyone with the office password may make an account of their own, until it's closed.
    const toggle = h('button.btn', { type: 'button', class: s.openRegistration ? 'danger' : '' }, s.openRegistration ? 'Close it' : 'Open it again');
    toggle.addEventListener('click', () => {
      if (!s.openRegistration) return net.send({ t: 'accounts.registration', on: true });
      confirmDialog(
        'Close registration?',
        'From now on new people need an invite link to get an account. Everyone who has one already keeps it.',
        'Close it',
        () => net.send({ t: 'accounts.registration', on: false }),
      );
    });
    body.append(
      h('div.team-head', {}, h('h4', {}, 'Registering with the office password'), toggle),
      h(
        'p.note',
        {},
        s.openRegistration
          ? 'Open: anyone who knows the office password can register an account of their own, as a member. Close it once everyone is in, so only invites make new accounts.'
          : 'Closed: new people come in with an invite link. Run agent-office accounts registration on on the office’s machine to open it from there.',
      ),
    );
    if (typing) nameInput.focus();
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error || !msg.invite) {
      status = h('p.team-status.error', {}, msg.error ?? 'Could not make the invite');
      return render();
    }
    fresh = msg.invite;
    nameInput.value = '';
    status = h('p.team-status.ok', {}, `✅ Send this link to ${msg.invite.name ?? 'them'}. It works once and expires after 7 days.`);
    render();
  };
  // No longer an admin (someone changed your role): the list isn't yours to see any more.
  const unsubs = [store.on('accounts', render), store.on('me', () => (store.me.admin ? render() : modal.close()))];
  const modal = openModal(el, {
    onClose: () => {
      unsubs.forEach((u) => u());
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => nameInput.focus(), 30);
  net.send({ t: 'accounts.get' });
}
