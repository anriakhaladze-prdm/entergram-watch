// The player drawer as a PDF: the same facts, sentiment, alerts and recent
// conversation, laid out on the design system's dark surface with its own
// typeface, so the export reads like the screen it came from.
import React from 'react';
import { Document, Page, View, Text, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { STATE, MOODS, age, mins } from './states.js';
import { OXANIUM } from './fonts.js';

const h = React.createElement;

// Tokens, resolved to solid colours (the PDF has no colour-mix).
const C = {
  page: '#1b1d29', card: '#202433', surface: '#262c3e', divider: '#3c4357',
  white: '#ffffff', text: '#dde4ec', muted1: '#858fa6', muted3: '#a0acc7', control: '#b8c2da',
  green: '#5cffc1', red: '#ff6b6b', orange: '#ff9966', yellow: '#ffd966', blue: '#00e5ff', purple: '#a666ff', peach: '#f7c8c1', gray: '#99a5bf',
};
const hex = (c) => c.replace('#', '').match(/.{2}/g).map((x) => parseInt(x, 16));
const mix = (fg, bg, a) => `#${hex(fg).map((v, i) => Math.round(v * a + hex(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
const TONE = { green: C.green, red: C.red, orange: C.orange, yellow: C.yellow, blue: C.blue, purple: C.purple, peach: C.peach, gray: C.gray };

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  Font.register({ family: 'Oxanium', fonts: Object.entries(OXANIUM).map(([w, src]) => ({ src, fontWeight: Number(w) })) });
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

const S = StyleSheet.create({
  page: { backgroundColor: C.page, padding: 24, fontFamily: 'Oxanium', fontWeight: 500, color: C.text, fontSize: 9.5 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 22, flexGrow: 1 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 20, fontWeight: 800, color: C.white },
  date: { fontSize: 8, color: C.muted1, fontWeight: 600, marginTop: 6 },
  badges: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  badge: { borderRadius: 20, paddingVertical: 3.5, paddingHorizontal: 7 },
  badgeText: { fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 },
  chatTitle: { fontSize: 8.5, color: C.muted1, marginLeft: 4 },
  signal: { marginTop: 14, fontSize: 10, color: C.text },
  meta: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.surface, borderRadius: 12, overflow: 'hidden' },
  cell: { width: '50%', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 0.5, borderBottomColor: C.card, borderRightWidth: 0.5, borderRightColor: C.card },
  key: { fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: C.muted3, marginBottom: 5 },
  val: { fontSize: 10, fontWeight: 600, color: C.white },
  valSub: { fontSize: 8.5, fontWeight: 500, color: C.muted1 },
  block: { marginTop: 16 },
  blockTitle: { fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: C.muted1, marginBottom: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { borderRadius: 20, borderWidth: 0.5, borderColor: C.divider, paddingVertical: 4, paddingHorizontal: 9, flexDirection: 'row', gap: 4 },
  chipText: { fontSize: 8.5, fontWeight: 600, color: C.control },
  chipNum: { fontSize: 8.5, fontWeight: 600, color: C.muted1 },
  para: { fontSize: 9.5, color: C.text, lineHeight: 1.45 },
  quote: { marginTop: 7, borderLeftWidth: 1.5, borderLeftColor: C.divider, paddingLeft: 9, color: C.muted3, fontSize: 9.5, lineHeight: 1.45 },
  msgs: { gap: 6 },
  msg: { maxWidth: '78%', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10 },
  msgStaff: { alignSelf: 'flex-end', backgroundColor: mix(C.green, C.surface, 0.08) },
  msgPlayer: { alignSelf: 'flex-start', backgroundColor: C.surface },
  msgOther: { alignSelf: 'flex-start', borderWidth: 0.5, borderColor: C.divider },
  msgSystem: { alignSelf: 'center', maxWidth: '100%', paddingVertical: 2 },
  msgMeta: { fontSize: 7, fontWeight: 600, color: C.muted3, marginBottom: 3 },
  msgText: { fontSize: 9.5, color: C.text, lineHeight: 1.4 },
  msgSystemText: { fontSize: 8.5, color: C.muted3, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 12, left: 24, right: 24, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: C.muted1, fontWeight: 600 },
});

// Oxanium has no emoji glyphs, so pictographs are dropped from the export
// rather than printed as empty boxes.
const clean = (t) => String(t || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/[ \t]{2,}/g, ' ').trim();

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '-');
const tierLabel = (t) => String(t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d)\b/g, (d) => ['', 'I', 'II', 'III', 'IV', 'V'][Number(d)] || d);

const Badge = (tone, label) => h(View, { style: [S.badge, { backgroundColor: mix(TONE[tone] || C.gray, C.card, 0.1) }] }, h(Text, { style: [S.badgeText, { color: TONE[tone] || C.gray }] }, label));
const Cell = (key, value, sub) => h(View, { style: S.cell }, h(Text, { style: S.key }, key), h(Text, { style: S.val }, value, sub ? h(Text, { style: S.valSub }, `  ${sub}`) : null));

export function playerDocument(row, conversation = null, { now = new Date() } = {}) {
  registerFonts();
  const st = STATE[row.state] || { label: row.state, tone: 'gray' };
  const mood = MOODS.find((m) => m.key === row.sentiment?.label);
  const name = row.playerUsername || row.player || row.title;
  const posted = Object.entries(row.alerts || {}).filter(([, v]) => v && !v.seeded);
  const messages = conversation?.messages || [];

  const cells = [
    Cell('We last spoke', row.lastStaffAt ? `${age(row.staffQuietDays)} ago` : '-', row.lastStaffBy || null),
    Cell('Player last spoke', row.lastPlayerAt ? `${age(row.playerQuietDays)} ago` : '-', row.ack ? 'closed the exchange' : null),
    Cell('Last message', row.lastMessageAt ? `${age(row.quietDays)} ago` : '-'),
    Cell('First reply', row.reply ? `median ${mins(row.reply.medianMins)}` : '-', row.reply ? `p90 ${mins(row.reply.p90Mins)} · worst ${mins(row.reply.worstMins)} · ${row.reply.samples} exchanges` : null),
    Cell('Members', row.membersCount != null ? String(row.membersCount) : '-'),
    Cell('Tier', row.tier ? tierLabel(row.tier) : '-'),
  ];

  return h(Document, { title: `${name} · Player outreach`, author: 'Thrill Player Ops' },
    h(Page, { size: 'A4', style: S.page },
      h(View, { style: S.card },
        h(View, { style: S.headRow },
          h(View, null,
            h(Text, { style: S.name }, name),
            h(View, { style: S.badges },
              Badge(st.tone, st.label),
              row.tier ? Badge('blue', tierLabel(row.tier)) : null,
              mood && mood.key !== 'neutral' ? Badge(mood.tone, mood.label) : null,
              h(Text, { style: S.chatTitle }, row.title || ''),
            ),
          ),
          h(Text, { style: S.date }, now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })),
        ),
        row.signals?.[0] && row.signals[0] !== row.sentiment?.reason ? h(Text, { style: S.signal }, row.signals[0]) : null,
        h(View, { style: S.meta }, ...cells),
        row.staffSpeakers?.length ? h(View, { style: S.block },
          h(Text, { style: S.blockTitle }, 'Staff who have replied'),
          h(View, { style: S.chips }, ...row.staffSpeakers.map((sp) => h(View, { style: S.chip, key: sp.id }, h(Text, { style: S.chipText }, sp.name), h(Text, { style: S.chipNum }, String(sp.msgs))))),
        ) : null,
        row.sentiment ? h(View, { style: S.block },
          h(Text, { style: S.blockTitle }, 'Sentiment'),
          h(Text, { style: S.para },
            h(Text, { style: { color: TONE[mood?.tone] || C.gray, fontWeight: 700, textTransform: 'uppercase' } }, (mood?.label || row.sentiment.label).toUpperCase()),
            row.sentiment.reason ? `  ·  ${row.sentiment.reason}` : ''),
          row.sentiment.quote ? h(Text, { style: S.quote }, clean(row.sentiment.quote)) : null,
        ) : null,
        posted.length ? h(View, { style: S.block },
          h(Text, { style: S.blockTitle }, 'Slack alerts'),
          ...posted.map(([k, v]) => h(Text, { style: S.para, key: k }, `${k === 'no_contact' ? '7 days without contact' : 'Churn signal'}  ·  ${when(v.at)}`)),
        ) : null,
        h(View, { style: S.block },
          h(Text, { style: S.blockTitle }, 'Recent conversation'),
          conversation?.unavailable ? h(Text, { style: S.para }, 'Not readable.') : null,
          h(View, { style: S.msgs }, ...messages.map((m, i) => {
            const sys = m.side === 'system';
            const style = [S.msg, m.side === 'staff' ? S.msgStaff : m.side === 'other' ? S.msgOther : sys ? S.msgSystem : S.msgPlayer];
            return h(View, { style, key: m.id || i, wrap: false },
              sys ? h(Text, { style: S.msgSystemText }, `${clean(m.text)}  ·  ${when(m.date)}`)
                : h(React.Fragment, null,
                  h(Text, { style: S.msgMeta }, `${m.name || ''}  ·  ${when(m.date)}`),
                  h(Text, { style: S.msgText }, clean(m.text) || '(media)')),
            );
          })),
        ),
      ),
      h(View, { style: S.footer, fixed: true },
        h(Text, { style: S.footerText }, `${name}  ·  ${row.title || ''}`),
        h(Text, { style: S.footerText, render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
      ),
    ),
  );
}

export const renderPlayerPdf = (row, conversation, opts) => renderToBuffer(playerDocument(row, conversation, opts));

// Named after the chat, the way it reads in Entergram: "algo7 x Thrill.com.pdf".
export const pdfFilename = (row) => `${String(row.title || row.playerUsername || row.player || row.chatId).replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'player'}.pdf`;
