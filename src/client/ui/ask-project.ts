// "Add a project first": what the office says when you go to something that needs a project (a desk,
// a board, the queue) and you aren't on one. Nothing makes you add one before then.
import { h, openModal } from './dom';

export function askProject(why: string, addOne: () => void) {
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const later = h('button.btn', { type: 'button' }, 'Not now');
  const add = h('button.btn.primary', { type: 'button' }, '🛗 Add a project');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Add a project', style: 'width:min(460px,100%)' },
    h('header', {}, h('h2', {}, '🛗 No project yet'), close),
    h('div.body', {}, h('p', { style: 'margin:0' }, why)),
    h('footer', {}, h('span.grow', {}), later, add),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  later.addEventListener('click', () => modal.close());
  add.addEventListener('click', () => {
    modal.close();
    addOne();
  });
  setTimeout(() => add.focus(), 0);
}
