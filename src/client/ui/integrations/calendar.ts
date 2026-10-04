// The calendar on the wall: today as a timeline, and the next seven days.
import type { CalendarEvent } from '../../../shared/composio-api';
import { h } from '../dom';
import { get } from './api';
import { empty, errorRow, footerNote, gate, loading, openPanel, type PanelDeps } from './common';

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (d: Date, today: Date) => {
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / DAY);
  const name = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return diff === 0 ? `Today · ${name}` : diff === 1 ? `Tomorrow · ${name}` : name;
};

export function eventRow(e: CalendarEvent, now = Date.now()): HTMLElement {
  const on = !e.allDay && new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now;
  return h(
    'div.cx-event',
    { class: on ? 'now' : '' },
    h('span.cx-time', {}, e.allDay ? 'All day' : `${time(e.start)}–${time(e.end)}`),
    h('span.cx-title', {}, e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.title) : e.title),
    e.location ? h('span.cx-where', {}, `📍 ${e.location}`) : null,
    e.attendees ? h('span.cx-where', {}, `👥 ${e.attendees}`) : null,
  );
}

/** The next things on, as the wall display shows them from across the room. */
export function upcomingLines(events: CalendarEvent[], now = Date.now()): string[] {
  return events
    .filter((e) => new Date(e.end).getTime() > now)
    .slice(0, 3)
    .map((e) => `${e.allDay ? 'All day' : time(e.start)}  ${e.title}`);
}

export function openCalendar(deps: PanelDeps) {
  const panel = openPanel('googlecalendar', { width: 760, doing: '📅 checking the calendar' });
  let events: CalendarEvent[] = [];

  const load = async () => {
    const blocked = gate('googlecalendar', panel, load);
    if (blocked) return panel.body.replaceChildren(blocked);
    panel.body.replaceChildren(loading('your calendar'));
    const today = startOfDay(new Date());
    try {
      events = await get<CalendarEvent[]>('calendar/events', { from: today.toISOString(), to: new Date(today.getTime() + 8 * DAY).toISOString() });
    } catch (err) {
      return panel.body.replaceChildren(errorRow(err, load));
    }
    deps.showCalendar?.(upcomingLines(events));
    panel.setTabs(
      [
        { id: 'today', label: '📅 Today', count: () => events.filter((e) => sameDay(e, today)).length },
        { id: 'week', label: '🗓️ Next 7 days', count: () => events.length },
      ],
      paint,
    );
    paint();
  };

  const sameDay = (e: CalendarEvent, day: Date) => {
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    return s < day.getTime() + DAY && en > day.getTime();
  };

  function paint() {
    panel.paintTabs();
    const today = startOfDay(new Date());
    if (panel.tab === 'today') {
      const todays = events.filter((e) => sameDay(e, today));
      return panel.body.replaceChildren(h('div.cx-day', {}, h('h4.today', {}, dayLabel(today, today)), todays.length ? h('div.cx-timeline.cx-day', {}, ...todays.map((e) => eventRow(e))) : empty('Nothing on today.')));
    }
    const days: HTMLElement[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(today.getTime() + i * DAY);
      const list = events.filter((e) => sameDay(e, day));
      if (!list.length && i > 0) continue;
      days.push(h('div.cx-day', {}, h('h4', { class: i === 0 ? 'today' : '' }, dayLabel(day, today)), ...(list.length ? list.map((e) => eventRow(e)) : [empty('Nothing on.')])));
    }
    panel.body.replaceChildren(...days);
  }

  footerNote(panel, 'Your primary Google Calendar, through Composio. Times are in your own time zone.');
  void load();
}
