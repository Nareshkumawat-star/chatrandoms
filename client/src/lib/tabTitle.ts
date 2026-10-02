/**
 * Browser tab title unread counter: "💬 (3) PulseChat".
 * Counts private unread messages; Global Chat activity can add a dot.
 */

let dmUnread = 0;
let globalActivity = false;
let globalMentions = 0;

function render() {
  const parts: string[] = [];
  if (dmUnread > 0) parts.push(`(${dmUnread > 99 ? '99+' : dmUnread})`);
  if (globalMentions > 0) parts.push(`(@${globalMentions > 9 ? '9+' : globalMentions})`);
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

export function resetTitle(): void {
  dmUnread = 0;
  globalActivity = false;
  globalMentions = 0;
  render();
}
