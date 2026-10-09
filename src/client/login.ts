export {}; // a module, so its names don't clash with the other pages' scripts

// Signing in, and registering an account of your own. Everyone in the office has an account: the
// first one registered is the office's admin; after that, anyone with the office password registers
// (while an admin keeps registration open), or comes in with an invite link (/join).

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const tabs = $<HTMLDivElement>('tabs');
const tabSignIn = $<HTMLButtonElement>('tab-signin');
const tabRegister = $<HTMLButtonElement>('tab-register');
const sub = $<HTMLParagraphElement>('sub');
const nameInput = $<HTMLInputElement>('name');
const password = $<HTMLInputElement>('password');
const officeRow = $<HTMLLabelElement>('office-row');
const officePassword = $<HTMLInputElement>('office-password');
const note = $<HTMLParagraphElement>('note');
const error = $<HTMLParagraphElement>('error');
const submit = $<HTMLButtonElement>('submit');

/** Where to go once in: the 2D view if that's where you were headed (see loginUrl in net.ts), else the office. */
const NEXT = new URLSearchParams(location.search).get('next') === '/lite' ? '/lite' : '/';
const PASSWORD_MIN = 8;

type Mode = 'signin' | 'register';
let mode: Mode = 'signin';
/** What the office says: whether anyone has an account yet, and whether the office password registers one. */
let opts = { accounts: true, registration: true };
/**
 * A link from the office's terminal (/login#key=…): it registers one account without the office
 * password. Taken out of the address bar at once; it's after the #, so it never reaches a server log.
 */
let linkKey = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';
const wantsRegister = location.hash === '#register';
if (linkKey || wantsRegister) history.replaceState(null, '', location.pathname + location.search);

function show(next: Mode) {
  mode = next;
  const registering = mode === 'register';
  tabSignIn.setAttribute('aria-selected', String(!registering));
  tabRegister.setAttribute('aria-selected', String(registering));
  // Registering is closed (and no link from the terminal): signing in is all there is.
  tabs.hidden = !opts.registration && !linkKey;
  officeRow.hidden = !registering || !!linkKey;
  officePassword.required = registering && !linkKey;
  password.autocomplete = registering ? 'new-password' : 'current-password';
  password.minLength = registering ? PASSWORD_MIN : 0;
  submit.textContent = registering ? 'Make my account' : 'Come on in';
  sub.textContent = registering ? 'New here? Make an account of your own.' : 'Knock knock. Who is it?';
  note.hidden = !registering;
  note.textContent = linkKey
    ? `Opened from the office's own terminal, so no office password is needed. Pick a password of at least ${PASSWORD_MIN} characters.`
    : `Pick a name and a password of at least ${PASSWORD_MIN} characters for yourself, and type the office password you were given.`;
  error.textContent = '';
  (nameInput.value ? password : nameInput).focus();
}

tabSignIn.addEventListener('click', () => show('signin'));
tabRegister.addEventListener('click', () => show('register'));

async function post(path: string, body: unknown): Promise<{ ok: boolean; body: { error?: string } }> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as { error?: string } };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  try {
    const name = nameInput.value.trim();
    const r =
      mode === 'signin'
        ? await post('/api/login', { name, password: password.value })
        : await post('/api/register', { name, password: password.value, ...(linkKey ? { key: linkKey } : { officePassword: officePassword.value }) });
    if (r.ok) return location.replace(NEXT);
    error.textContent = r.body.error ?? (mode === 'signin' ? 'Could not sign in' : 'Could not make the account');
    // A used-up link: carry on with the office password.
    if (/link was/i.test(error.textContent)) {
      linkKey = '';
      show(mode);
      error.textContent = r.body.error ?? '';
    }
    password.select();
  } catch {
    error.textContent = 'Server unreachable';
  } finally {
    submit.disabled = false;
  }
});

async function start() {
  try {
    const o = (await (await fetch('/api/login', { cache: 'no-store' })).json()) as Partial<typeof opts>;
    opts = { accounts: o.accounts === true, registration: o.registration !== false };
  } catch {
    // Server unreachable: the form says so when it's sent.
  }
  if (linkKey) {
    const r = await post('/api/link', { key: linkKey }).catch(() => ({ ok: false, body: {} as { error?: string } }));
    if (!r.ok) {
      linkKey = '';
      // An account already? Then sign in; the link was for registering.
      show(opts.accounts ? 'signin' : 'register');
      error.textContent = r.body.error ?? '';
      return;
    }
    return show(opts.accounts ? 'signin' : 'register');
  }
  show(wantsRegister && opts.registration ? 'register' : 'signin');
}
void start();
