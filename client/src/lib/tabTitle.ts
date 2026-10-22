/**
 * Browser tab title unread counter: "💬 (3) PulseChat".
 * Counts private unread messages; Global Chat activity can add a dot.
 */

let dmUnread = 0;
let globalActivity = false;
let globalMentions = 0;
let dmMentions = 0;

function render() {
  const parts: string[] = [];
  if (dmUnread > 0) parts.push(`(${dmUnread > 99 ? '99+' : dmUnread})`);
  const mentions = globalMentions + dmMentions;
  if (mentions > 0) parts.push(`(@${mentions > 9 ? '9+' : mentions})`);
  else if (dmUnread === 0 && globalActivity) parts.push('•');
  document.title = parts.length ? `${parts.join(' ')} PulseChat` : 'PulseChat — Global & Private Chat';
}

export function setDmUnread(count: number): void {
  dmUnread = Math.max(0, count);
  render();
}

export function setGlobalActivity(active: boolean): void {
  globalActivity = active;
  render();
}

/** Unread @mention count for Global Chat — shows as "(@2)" in the title. */
export function setGlobalMentions(count: number): void {
  globalMentions = Math.max(0, count);
  render();
}

/** Unread @mention count across private chats — folded into the same "(@n)". */
export function setDmMentions(count: number): void {
  dmMentions = Math.max(0, count);
  render();
}

export function resetTitle(): void {
  dmUnread = 0;
  globalActivity = false;
  globalMentions = 0;
  dmMentions = 0;
  render();
}
