import { User } from '../models/User.js';

export type Mention = { userId: string; username: string };

const MENTION_RE = /@([a-zA-Z0-9_.]{2,30})/g;

/**
 * Resolve @handles in a message to real users (case-insensitive via
 * usernameLower), excluding the sender. Unknown handles are ignored so the
 * client only ever highlights people who actually exist.
 */
export async function resolveMentions(text: string, senderId: string): Promise<Mention[]> {
  const handles = new Set<string>();
  const re = new RegExp(MENTION_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) handles.add(m[1].toLowerCase());
  if (handles.size === 0) return [];

  const users = await User.find({ usernameLower: { $in: [...handles].slice(0, 10) } })
    .select('username')
    .lean();

  return users
    .filter((u) => String(u._id) !== senderId)
    .map((u) => ({ userId: String(u._id), username: u.username }));
}
