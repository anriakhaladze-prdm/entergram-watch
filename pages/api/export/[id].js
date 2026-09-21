// The player drawer as a PDF download: the stored row plus the recent
// conversation read live, rendered on the design system's surface.
import { createClient } from '../../../lib/entergram.js';
import { getSnapshot } from '../../../lib/state.js';
import { readConversation } from '../../../lib/conversation.js';
import { renderPlayerPdf, pdfFilename } from '../../../lib/pdf.js';
import { requireSession } from '../../../lib/auth.js';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  if (!(await requireSession(req, res))) return;
  const id = String(req.query.id || '');
  if (!/^-?\d+$/.test(id)) return res.status(400).json({ error: 'bad chat id' });
  try {
    const snap = await getSnapshot();
    const row = snap?.rows?.find((r) => String(r.chatId) === id);
    if (!row) return res.status(404).json({ error: 'chat not in the current snapshot' });
    const conversation = await readConversation(createClient(), id, { limit: 60 });
    const pdf = await renderPlayerPdf(row, conversation);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${pdfFilename(row)}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).send(pdf);
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
}
