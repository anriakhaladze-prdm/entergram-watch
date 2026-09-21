// The recent conversation of one chat, read live from Entergram and shaped for
// display: who is on which side, what to call them, what they said. Never
// stored. Only groups the reader account belongs to can be read; anything
// else answers unavailable.
import { normalizeMessage } from './facts.js';
import { READER_ACCOUNT_ID, isStaffSender, staffLabel, isBot, isThirdParty, thirdPartyName } from './team.js';

export async function readConversation(api, chatId, { limit = 40 } = {}) {
  const id = String(chatId);
  try {
    const r = await api.messages(id, READER_ACCOUNT_ID, { limit });
    if (!r.items.length) return { chatId: id, unavailable: true, messages: [] };
    const messages = r.items.map(normalizeMessage)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((m) => {
        const staff = m.isOut || isStaffSender(m.senderId, m.senderName);
        const side = m.actionType ? 'system' : staff ? 'staff' : isBot(m.senderId) ? 'system' : isThirdParty(m.senderId) ? 'other' : 'player';
        return {
          id: m.id, date: m.date, side,
          name: m.actionType ? null : staff ? staffLabel(m.senderId, m.senderName) : side === 'other' ? (thirdPartyName(m.senderId) || m.senderName) : (m.senderName || 'player'),
          text: m.actionType ? (m.text || m.actionType) : m.text.slice(0, 400),
        };
      });
    return { chatId: id, unavailable: false, hasMore: r.hasMore, messages };
  } catch (e) {
    return { chatId: id, unavailable: true, error: String(e.message).slice(0, 200), messages: [] };
  }
}
