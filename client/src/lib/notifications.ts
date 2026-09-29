/**
 * Browser notifications via the Notifications API.
 * - Only fires while the tab is hidden/unfocused (in-tab sounds cover the rest).
 * - Clicking a notification focuses the tab and opens the conversation.
 * - Note: iOS Safari requires a service worker for notifications; unsupported
 *   there outside PWA mode — every call degrades silently.
 */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/** Ask the user for permission. Must be called from a user gesture (button click). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Show a message notification. No-ops unless permission is granted and the
 * tab is hidden. `silent: true` because the in-app chime already played.
 */
export function showMessageNotification(opts: {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  onClick?: () => void;
}): void {
  if (!notificationsSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon,
      tag: opts.tag, // same conversation replaces its previous notification
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
  } catch {
    /* constructor unavailable (e.g. Android Chrome SW-only) — ignore */
  }
}
