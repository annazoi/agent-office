// What each station does, as Composio tool calls: the tool slugs and parameter names below are the
// ones Composio's tool schemas give (docs.composio.dev/api/tools/<SLUG>), and the answers are cut
// down to what the panels show (src/shared/integrations/composio-api.ts). Nothing here knows about HTTP or who
// is asking: the hub runs each call as the person whose station it is.
import type {
  CalendarEvent,
  LinearBucket,
  LinearCreateBody,
  LinearIssue,
  LinearIssuesResult,
  LinearUpdateBody,
  MailMessage,
  MailReplyBody,
  MailSendBody,
  MailSummary,
  NotionCreateBody,
  NotionPage,
  NotionPageContent,
  SlackChannel,
  SlackMessage,
  SlackSendBody,
} from '../../shared/integrations/composio-api.js';
import type { ComposioToolkit } from '../../shared/protocol.js';
import { str } from '../office/input.js';

type Data = Record<string, unknown>;
/** Runs one tool as the person: what the hub gives us. */
export type Run = (toolkit: ComposioToolkit, slug: string, args: Data) => Promise<Data>;

const s = (x: unknown, max = 4000): string => (typeof x === 'string' ? x.slice(0, max) : '');
const n = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const arr = (x: unknown): Data[] => (Array.isArray(x) ? (x.filter((v) => v && typeof v === 'object') as Data[]) : []);
const obj = (x: unknown): Data => (x && typeof x === 'object' ? (x as Data) : {});
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A required string field of a request body, cleaned; throws the message the browser shows. */
export function need(body: Data, key: string, max = 2000): string {
  const v = str(body[key], max);
  if (!v) throw new Error(`Missing ${key}`);
  return v;
}

// ---------------------------------------------------------------- Linear

/** Linear's workflow states have free names; the tabs go by what the name says. */
export function linearBucket(state: string): LinearBucket {
  if (/done|complete|closed|cancel|duplicate|released|shipped/i.test(state)) return 'done';
  if (/progress|review|started|doing|testing|qa|blocked/i.test(state)) return 'progress';
  return 'mine';
}

function linearIssue(it: Data): LinearIssue {
  const state = s(obj(it.state).name, 80);
  return {
    id: s(it.id, 100),
    identifier: s(it.identifier, 40),
    title: s(it.title, 300),
    url: s(it.url, 500) || undefined,
    description: s(it.description, 4000) || undefined,
    state: state || undefined,
    bucket: linearBucket(state),
    priority: n(it.priority),
    assignee: s(obj(it.assignee).name, 100) || undefined,
    team: s(obj(it.team).name, 100) || undefined,
    project: s(obj(it.project).name, 100) || undefined,
    updatedAt: s(it.updatedAt, 40) || undefined,
  };
}

export const linear = {
  async issues(run: Run): Promise<LinearIssuesResult> {
    const [issues, teams] = await Promise.all([run('linear', 'LINEAR_LIST_LINEAR_ISSUES', { first: 100 }), run('linear', 'LINEAR_LIST_LINEAR_TEAMS', { first: 50 })]);
    return {
      issues: arr(issues.issues).map(linearIssue),
      teams: arr(teams.teams).map((t) => ({ id: s(t.id, 100), name: s(t.name, 100) })),
    };
  },
  async create(run: Run, body: Data): Promise<{ issue: LinearIssue; summary: string }> {
    const b: LinearCreateBody = { title: need(body, 'title', 300), teamId: need(body, 'teamId', 100), description: str(body.description, 20000) || undefined, priority: n(body.priority) };
    const args: Data = { title: b.title, team_id: b.teamId };
    if (b.description) args.description = b.description;
    if (b.priority !== undefined) args.priority = Math.max(0, Math.min(4, Math.round(b.priority)));
    const d = await run('linear', 'LINEAR_CREATE_LINEAR_ISSUE', args);
    const issue: LinearIssue = { id: s(d.id, 100), identifier: '', title: s(d.issue_title, 300) || b.title, url: s(d.ticket_url, 500) || undefined, description: s(d.issue_description) || undefined, bucket: 'mine' };
    return { issue, summary: `📐 created Linear issue “${clip(b.title, 40)}”` };
  },
  async update(run: Run, body: Data): Promise<{ issue: LinearIssue; summary: string }> {
    const b: LinearUpdateBody = { issueId: need(body, 'issueId', 100), title: str(body.title, 300) || undefined, description: str(body.description, 20000) || undefined, stateId: str(body.stateId, 100) || undefined, priority: n(body.priority) };
    const args: Data = { issueId: b.issueId };
    if (b.title) args.title = b.title;
    if (b.description) args.description = b.description;
    if (b.stateId) args.stateId = b.stateId;
    if (b.priority !== undefined) args.priority = Math.max(0, Math.min(4, Math.round(b.priority)));
    const d = await run('linear', 'LINEAR_UPDATE_ISSUE', args);
    const issue = linearIssue(obj(d.issue));
    return { issue, summary: `📐 updated Linear issue ${issue.identifier || clip(issue.title, 30)}` };
  },
};

// ---------------------------------------------------------------- Notion

/** A page's title: Notion keeps it under whichever property is the title one. */
function notionTitle(it: Data): string {
  const rich = (x: unknown) =>
    arr(x)
      .map((r) => s(r.plain_text, 300))
      .join('');
  if (Array.isArray(it.title)) return rich(it.title);
  for (const p of Object.values(obj(it.properties))) {
    const prop = obj(p);
    if (prop.type === 'title') return rich(prop.title);
  }
  return '';
}

function notionPage(it: Data): NotionPage {
  const icon = obj(it.icon);
  return {
    id: s(it.id, 100),
    title: notionTitle(it) || 'Untitled',
    url: s(it.url, 500) || undefined,
    icon: icon.type === 'emoji' ? s(icon.emoji, 8) : undefined,
    kind: it.object === 'database' || it.object === 'data_source' ? 'database' : 'page',
    editedAt: s(it.last_edited_time, 40) || undefined,
  };
}

export const notion = {
  async search(run: Run, query: string): Promise<NotionPage[]> {
    const args: Data = { page_size: 25, direction: 'descending', timestamp: 'last_edited_time' };
    if (query) args.query = query;
    const d = await run('notion', 'NOTION_SEARCH_NOTION_PAGE', args);
    return arr(d.results).map(notionPage);
  },
  async page(run: Run, pageId: string): Promise<NotionPageContent> {
    const [page, md] = await Promise.all([run('notion', 'NOTION_RETRIEVE_PAGE', { page_id: pageId }), run('notion', 'NOTION_GET_PAGE_MARKDOWN', { page_id: pageId })]);
    return { ...notionPage(page), markdown: s(md.markdown, 200_000), truncated: md.truncated === true || undefined };
  },
  async create(run: Run, body: Data): Promise<{ page: NotionPage; summary: string }> {
    const b: NotionCreateBody = { parentId: need(body, 'parentId', 200), title: need(body, 'title', 300), markdown: str(body.markdown, 100_000) || undefined };
    const args: Data = { parent_id: b.parentId, title: b.title };
    if (b.markdown) args.markdown = b.markdown;
    const d = await run('notion', 'NOTION_CREATE_NOTION_PAGE', args);
    const page = notionPage(d);
    if (page.title === 'Untitled') page.title = b.title;
    return { page, summary: `📓 wrote Notion page “${clip(b.title, 40)}”` };
  },
};

// ---------------------------------------------------------------- Slack

export const slack = {
  async channels(run: Run): Promise<SlackChannel[]> {
    const d = await run('slack', 'SLACK_LIST_ALL_CHANNELS', { limit: 200, types: 'public_channel,private_channel', exclude_archived: true });
    return arr(d.channels)
      .map((c) => ({ id: s(c.id, 40), name: s(c.name, 100), private: c.is_private === true, member: c.is_member === true, members: n(c.num_members) }))
      .filter((c) => c.id && c.name)
      .sort((a, b) => Number(b.member) - Number(a.member) || a.name.localeCompare(b.name));
  },
  async history(run: Run, channel: string, limit = 20): Promise<SlackMessage[]> {
    const d = await run('slack', 'SLACK_FETCH_CONVERSATION_HISTORY', { channel, limit });
    return arr(d.messages)
      .map((m) => ({ ts: s(m.ts, 40), user: s(m.user, 40) || s(m.username, 80) || (m.bot_id ? 'bot' : undefined), text: s(m.text, 4000), replies: n(m.reply_count) || undefined }))
      .filter((m) => m.ts)
      .reverse();
  },
  async send(run: Run, body: Data): Promise<{ ts: string; summary: string }> {
    const b: SlackSendBody = { channel: need(body, 'channel', 100), text: need(body, 'text', 4000) };
    const d = await run('slack', 'SLACK_SEND_MESSAGE', { channel: b.channel, markdown_text: b.text });
    return { ts: s(d.ts, 40), summary: `💬 posted to Slack #${str(body.channelName, 80) || b.channel}` };
  },
};

// ---------------------------------------------------------------- Google Calendar

export const calendar = {
  async events(run: Run, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
    const d = await run('googlecalendar', 'GOOGLECALENDAR_EVENTS_LIST', { calendarId: 'primary', timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 100 });
    return arr(d.items)
      .filter((e) => e.status !== 'cancelled')
      .map((e) => {
        const start = obj(e.start);
        const end = obj(e.end);
        const allDay = !start.dateTime;
        return {
          id: s(e.id, 200),
          title: s(e.summary, 300) || '(no title)',
          start: s(start.dateTime, 40) || s(start.date, 40),
          end: s(end.dateTime, 40) || s(end.date, 40),
          allDay,
          location: s(e.location, 300) || undefined,
          url: s(e.htmlLink, 500) || undefined,
          attendees: arr(e.attendees).length || undefined,
        };
      });
  },
};

// ---------------------------------------------------------------- Gmail

function mailSummary(m: Data): MailSummary {
  return {
    id: s(m.messageId, 100),
    threadId: s(m.threadId, 100),
    from: s(m.sender, 300),
    to: s(m.to, 1000) || undefined,
    subject: s(m.subject, 500) || '(no subject)',
    at: s(m.messageTimestamp, 60) || undefined,
    preview: s(m.preview, 300) || undefined,
    unread: Array.isArray(m.labelIds) && (m.labelIds as unknown[]).includes('UNREAD'),
  };
}

export const gmail = {
  async unread(run: Run): Promise<MailSummary[]> {
    const d = await run('gmail', 'GMAIL_FETCH_EMAILS', { query: 'is:unread', label_ids: ['INBOX'], max_results: 25, include_payload: false, verbose: true });
    return arr(d.messages)
      .map((m) => ({ ...mailSummary(m), unread: true }))
      .filter((m) => m.id)
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  },
  async message(run: Run, id: string): Promise<MailMessage> {
    const d = await run('gmail', 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', { message_id: id, format: 'full' });
    return { ...mailSummary(d), text: s(d.messageText, 100_000) || s(d.preview, 1000) };
  },
  async send(run: Run, body: Data): Promise<{ id: string; summary: string }> {
    const b: MailSendBody = { to: need(body, 'to', 500), subject: need(body, 'subject', 500), body: need(body, 'body', 50_000) };
    const d = await run('gmail', 'GMAIL_SEND_EMAIL', { recipient_email: b.to, subject: b.subject, body: b.body });
    return { id: s(d.id, 100), summary: `✉️ sent an email to ${clip(b.to, 40)}` };
  },
  async draft(run: Run, body: Data): Promise<{ id: string; summary: string }> {
    const b: MailSendBody = { to: need(body, 'to', 500), subject: str(body.subject, 500), body: need(body, 'body', 50_000) };
    const args: Data = { recipient_email: b.to, body: b.body };
    if (b.subject) args.subject = b.subject;
    const threadId = str(body.threadId, 100);
    if (threadId) args.thread_id = threadId;
    const d = await run('gmail', 'GMAIL_CREATE_EMAIL_DRAFT', args);
    return { id: s(d.id, 100), summary: `✉️ drafted an email to ${clip(b.to, 40)}` };
  },
  async reply(run: Run, body: Data): Promise<{ id: string; summary: string }> {
    const b: MailReplyBody = { threadId: need(body, 'threadId', 100), to: need(body, 'to', 500), body: need(body, 'body', 50_000) };
    const d = await run('gmail', 'GMAIL_REPLY_TO_THREAD', { thread_id: b.threadId, recipient_email: b.to, message_body: b.body });
    return { id: s(d.id, 100), summary: `✉️ replied to ${clip(b.to, 40)}` };
  },
};
