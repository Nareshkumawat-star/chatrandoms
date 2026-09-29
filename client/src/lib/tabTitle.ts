/**
 * Browser tab title unread counter: "💬 (3) PulseChat".
 * Counts private unread messages; Global Chat activity can add a dot.
 */

let dmUnread = 0;
let globalActivity = false;

function render() {
  const parts: string[] = [];
  if (dmUnread > 0) parts.push(`(${dmUnread > 99 ? '99+' : dmUnread})`);
  else if (globalActivity) parts.push('•');
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

export function resetTitle(): void {
  dmUnread = 0;
  globalActivity = false;
  render();
}
