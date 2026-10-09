// What the Composio stations' HTTP API (/api/composio/…, src/server/http/composio.ts) answers with:
// the few fields each panel shows, cut down from Composio's own answers so the browser never has to
// know a toolkit's wire format. Pure types, used by both sides.
import type { ComposioConnections, ComposioState, ComposioToolkit } from '../protocol/composio.js';

export const COMPOSIO_API = '/api/composio';

export interface ComposioStatus {
  office: ComposioState;
  mine: ComposioConnections;
}

/** Where a station's "Connect" button sends you. */
export interface ComposioConnectLink {
  url: string;
}

// Linear
export type LinearBucket = 'mine' | 'progress' | 'done';
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url?: string;
  description?: string;
  state?: string;
  bucket: LinearBucket;
  priority?: number;
  assignee?: string;
  team?: string;
  project?: string;
  updatedAt?: string;
}
export interface LinearTeam {
  id: string;
  name: string;
}
export interface LinearIssuesResult {
  issues: LinearIssue[];
  teams: LinearTeam[];
}
export interface LinearCreateBody {
  title: string;
  teamId: string;
  description?: string;
  priority?: number;
}
export interface LinearUpdateBody {
  issueId: string;
  title?: string;
  description?: string;
  stateId?: string;
  priority?: number;
}

// Notion
export interface NotionPage {
  id: string;
  title: string;
  url?: string;
  icon?: string;
  kind: 'page' | 'database';
  editedAt?: string;
}
export interface NotionPageContent extends NotionPage {
  markdown: string;
  truncated?: boolean;
}
export interface NotionCreateBody {
  parentId: string;
  title: string;
  markdown?: string;
}

// Slack
export interface SlackChannel {
  id: string;
  name: string;
  private: boolean;
  member: boolean;
  members?: number;
}
export interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  replies?: number;
}
export interface SlackSendBody {
  channel: string;
  text: string;
}

// Google Calendar
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  url?: string;
  attendees?: number;
}

// Gmail
export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  at?: string;
  preview?: string;
  unread: boolean;
}
export interface MailMessage extends MailSummary {
  text: string;
}
export interface MailSendBody {
  to: string;
  subject: string;
  body: string;
}
export interface MailReplyBody {
  threadId: string;
  to: string;
  body: string;
}

/** What every action answers once it worked: its result, and the line that floats over your head. */
export interface ComposioDone<T> {
  result: T;
  summary: string;
  toolkit: ComposioToolkit;
}
