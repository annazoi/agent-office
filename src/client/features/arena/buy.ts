import { ARMOUR_PRICE, GEAR } from '../../../shared/games/fps/gear';
import { WEAPONS, type Weapon } from '../../../shared/games/fps/weapons';
import { allowed } from '../../../shared/games/match';
import type { Net } from '../../shared/net';
import { store } from '../../state';
import { h, openModal, type Modal } from '../../ui/dom';

// The buy menu, open at the start of a round. It only ever asks; the office checks the match allows
// the thing, that the round is still in its buy time and that you can afford it before anything
// changes hands.

const KIND_NAMES: Record<Weapon['kind'], string> = { melee: 'Melee', pistol: 'Pistols', smg: 'Submachine guns', rifle: 'Rifles', shotgun: 'Shotguns', sniper: 'Sniper rifles', heavy: 'Heavy' };

/** What a gun says about itself on its button. */
const blurb = (w: Weapon) => `${w.damage} dmg · ${w.rpm} rpm · ${w.mag === Infinity ? '∞' : w.mag} rounds · ${w.range}m`;

export function openBuy(net: Net): Modal {
  const body = h('div.body');
  const el = h('div.modal.arena-buy', { role: 'dialog', 'aria-label': 'Buy menu' }, h('header', {}, h('h2', {}, '🛒 Buy')), body, h('footer', {}, h('span.grow'), h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Done')));

  function render() {
    const you = store.gameYou;
    const s = store.game.settings;
    const have = new Set(you.weapons);
    const groups = [...new Set(WEAPONS.filter((w) => w.price > 0 && allowed(s.weapons, w.id)).map((w) => w.kind))];
    const buttons = (list: Weapon[]) =>
      h(
        'div.guns',
        {},
        ...list.map((w) =>
          h(
            'button.gun',
            { type: 'button', disabled: have.has(w.id) || you.money < w.price, onclick: () => net.send({ t: 'game.buy', weapon: w.id }) },
            h('span.grow', {}, `${w.emoji} ${w.name}`, h('small', {}, blurb(w))),
            h('span.money', {}, have.has(w.id) ? 'carried' : `$${w.price}`),
          ),
        ),
      );
    body.replaceChildren(
      h('p', { style: 'margin:0 0 8px;font-weight:800' }, `You have $${you.money}. The buy menu closes once the round is under way.`),
      ...groups.flatMap((kind) => [h('h4', { style: 'margin:6px 0 2px' }, KIND_NAMES[kind]), buttons(WEAPONS.filter((w) => w.kind === kind && w.price > 0 && allowed(s.weapons, w.id)))]),
      h('h4', { style: 'margin:6px 0 2px' }, 'Equipment'),
      h(
        'div.guns',
        {},
        ...GEAR.filter((g) => allowed(s.gear, g.id)).map((g) =>
          h(
            'button.gun',
            { type: 'button', disabled: (you.gear[g.id] ?? 0) >= g.carried || you.money < g.price, onclick: () => net.send({ t: 'game.buy', gear: g.id }) },
            h('span.grow', {}, `${g.emoji} ${g.name}`, h('small', {}, `${g.blurb} · carrying ${you.gear[g.id] ?? 0}/${g.carried}`)),
            h('span.money', {}, `$${g.price}`),
          ),
        ),
        h(
          'button.gun',
          { type: 'button', disabled: you.armour || you.money < ARMOUR_PRICE, onclick: () => net.send({ t: 'game.buy', armour: true }) },
          h('span.grow', {}, '🛡️ Armour', h('small', {}, 'Takes about half off what hits your body')),
          h('span.money', {}, you.armour ? 'worn' : `$${ARMOUR_PRICE}`),
        ),
      ),
    );
  }

  const modal = openModal(el, { doing: 'in the arena' });
  const off = store.on('gameYou', render);
  const offMatch = store.on('game', render);
  const closed = modal.close;
  modal.close = () => {
    off();
    offMatch();
    closed.call(modal);
  };
  render();
  return modal;
}
