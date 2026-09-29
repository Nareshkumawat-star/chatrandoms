/** Remove control chars, collapse whitespace, trim, and hard-limit length. */
export function sanitizeText(input: unknown, maxLength = 1000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(
    /(\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)/gu,
    ''
  );
  return stripped.length === 0 && text.length > 0;
}

export function timeAgo(date: Date | string | number): string {
  const d = new Date(date).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
