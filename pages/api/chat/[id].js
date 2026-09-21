// The drill-in behind a player row: the recent conversation, read live from
// Entergram for a signed-in operator and never stored.
import { createClient } from '../../../lib/entergram.js';
import { readConversation } from '../../../lib/conversation.js';
import { requireSession } from '../../../lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireSession(req, res))) return;
  const id = String(req.query.id || '');
  if (!/^-?\d+$/.test(id)) return res.status(400).json({ error: 'bad chat id' });
  const limit = Math.min(60, Math.max(10, Number(req.query.limit) || 40));
  const out = await readConversation(createClient(), id, { limit });
  res.setHeader('cache-control', 'private, no-store');
  res.status(200).json(out);
}
