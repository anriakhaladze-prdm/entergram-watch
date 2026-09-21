// The player drawer as a PDF download: the stored row plus the recent
// conversation read live, rendered on the design system's surface.
import { createClient } from '../../../lib/entergram.js';
import { getSnapshot } from '../../../lib/state.js';
import { readConversation } from '../../../lib/conversation.js';
import { renderPlayerPdf, pdfFilename } from '../../../lib/pdf.js';
import { requireSession } from '../../../lib/auth.js';

export const config = { maxDuration: 60, api: { responseLimit: false } };

const fail = (res, status, text) => { res.setHeader('content-type', 'text/plain; charset=utf-8'); res.status(status).send(text); };

export default async function handler(req, res) {
  if (!(await requireSession(req, res))) return;
  const id = String(req.query.id || '');
  if (!/^-?\d+$/.test(id)) return fail(res, 400, 'bad chat id');
  let step = 'snapshot';
  try {
    const snap = await getSnapshot();
    const row = snap?.rows?.find((r) => String(r.chatId) === id);
    if (!row) return fail(res, 404, 'chat not in the current snapshot');
    step = 'conversation';
    const conversation = await readConversation(createClient(), id, { limit: 60 });
    step = 'render';
    const pdf = await renderPlayerPdf(row, conversation);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-length', String(pdf.length));
    res.setHeader('content-disposition', `attachment; filename="${pdfFilename(row)}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.status(200).end(pdf);
  } catch (e) {
    console.error(`[export] ${id} failed at ${step}: ${e.stack || e.message}`);
    fail(res, 500, `PDF export failed at ${step}: ${String(e.message).slice(0, 300)}`);
  }
}
