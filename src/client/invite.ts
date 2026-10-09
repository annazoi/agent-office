export {}; // a module, so its names don't clash with the other pages' scripts

// An organisation invite, /invite#<token> (see server/http/routes/orgs.ts): accept it as whoever
// you're signed in as, sign in with the account you have, or, when an office admin sent it, make
// one. The token rides in the fragment, so it never reaches a server log or a Referer header.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = location.hash.slice(1);
const form = $<HTMLFormElement>('form');
const name = $<HTMLInputElement>('name');
const password = $<HTMLInputElement>('password');
const again = $<HTMLInputElement>('again');
const submit = $<HTMLButtonElement>('submit');
const accept = $<HTMLButtonElement>('accept');
const error = $('error');
let mode: 'login' | 'register' = 'login';

interface Peek {
  org: string;
  role: string;
  email: string;
  by: string;
  signedInAs?: string;
  already: boolean;
  canRegister: boolean;
}

function fail(msg: string) {
  $('sub').textContent = '';
  form.hidden = true;
  $('tabs').hidden = true;
  $('accept-row').hidden = true;
  error.textContent = msg;
  $('home').hidden = false;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
  const res = await fetch('/api/org-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

function show(next: 'login' | 'register') {
  mode = next;
  $('tab-login').setAttribute('aria-selected', String(next === 'login'));
  $('tab-register').setAttribute('aria-selected', String(next === 'register'));
  $('again-row').hidden = next === 'login';
  again.required = next === 'register';
  password.autocomplete = next === 'login' ? 'current-password' : 'new-password';
  password.minLength = next === 'login' ? 0 : 8;
  $('form-note').textContent = next === 'login' ? 'Sign in with your Agent Office account.' : 'Pick a name, and a password of at least 8 characters, for your new account.';
  submit.textContent = next === 'login' ? 'Sign in and accept' : 'Make my account and accept';
  error.textContent = '';
}

/** Joined: into the office, working in the organisation. */
function joined(org: string) {
  $('title').textContent = `Welcome to ${org} 🎉`;
  $('sub').textContent = 'Taking you to the office…';
  form.hidden = true;
  $('tabs').hidden = true;
  $('accept-row').hidden = true;
  setTimeout(() => location.replace('/'), 600);
}

async function peek() {
  if (!token) return fail('This link is missing its invite code. Ask whoever sent it for the whole link.');
  try {
    const r = await post({ peek: true });
    if (!r.ok) return fail(r.body.error ?? 'This invite link does not work.');
    const p = r.body as Peek;
    $('title').textContent = `Join ${p.org}`;
    $('sub').textContent = `${p.by} invited ${p.email} to ${p.org} as ${p.role === 'member' ? 'a member' : `an ${p.role}`}.`;
    if (p.signedInAs) {
      $('accept-row').hidden = false;
      $('switch-note').textContent = p.already ? `You're signed in as ${p.signedInAs}, who is in ${p.org} already.` : `You'll join as ${p.signedInAs}, the account you're signed in with.`;
      accept.focus();
      return;
    }
    form.hidden = false;
    $('tabs').hidden = !p.canRegister;
    show('login');
    name.focus();
  } catch {
    fail('Server unreachable.');
  }
}

accept.addEventListener('click', async () => {
  accept.disabled = true;
  error.textContent = '';
  try {
    const r = await post({ action: 'accept' });
    if (!r.ok) error.textContent = r.body.error ?? 'Could not accept the invite';
    else joined(r.body.org);
  } catch {
    error.textContent = 'Server unreachable';
  } finally {
    accept.disabled = false;
  }
});

$('tab-login').addEventListener('click', () => show('login'));
$('tab-register').addEventListener('click', () => show('register'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  if (mode === 'register' && password.value !== again.value) {
    error.textContent = "Those passwords don't match";
    again.select();
    return;
  }
  submit.disabled = true;
  try {
    const r = await post({ action: mode, name: name.value.trim(), password: password.value });
    if (!r.ok) error.textContent = r.body.error ?? 'Could not accept the invite';
    else joined(r.body.org);
  } catch {
    error.textContent = 'Server unreachable';
  } finally {
    submit.disabled = false;
  }
});

void peek();
