// The drill-in behind a player row: the recent conversation, read live from
// Entergram for a signed-in operator and never stored. Only groups the reader
// account belongs to can be read; anything else answers unavailable.
import { createClient } from '../../../lib/entergram.js';
import { normalizeMessage } from '../../../lib/facts.js';
import { READER_ACCOUNT_ID, isStaffSender, staffLabel, isBot, isThirdParty, thirdPartyName } from '../../../lib/team.js';
import { requireSession } from '../../../lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireSession(req, res))) return;
  const id = String(req.query.id || '');
  if (!/^-?\d+$/.test(id)) return res.status(400).json({ error: 'bad chat id' });
  const limit = Math.min(60, Math.max(10, Number(req.query.limit) || 40));
  try {
    const api = createClient();
    const r = await api.messages(id, READER_ACCOUNT_ID, { limit });
    if (!r.items.length) return res.status(200).json({ chatId: id, unavailable: true, messages: [] });
    const messages = r.items.map(normalizeMessage)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((m) => ({
        id: m.id, date: m.date,
        side: m.actionType ? 'system' : (m.isOut || isStaffSender(m.senderId, m.senderName)) ? 'staff' : isBot(m.senderId) ? 'system' : isThirdParty(m.senderId) ? 'other' : 'player',
        name: m.actionType ? null : (m.isOut || isStaffSender(m.senderId, m.senderName)) ? staffLabel(m.senderId, m.senderName) : isThirdParty(m.senderId) ? (thirdPartyName(m.senderId) || m.senderName) : (m.senderName || 'player'),
        text: m.actionType ? (m.text || m.actionType) : m.text.slice(0, 400),
      }));
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).json({ chatId: id, unavailable: false, hasMore: r.hasMore, messages });
  } catch (e) {
    res.status(200).json({ chatId: id, unavailable: true, error: String(e.message).slice(0, 200), messages: [] });
  }
}
