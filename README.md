# Entergram Watch

Raises a Slack alert when a hosted player goes quiet or is left waiting, and
serves a dashboard showing outreach coverage across every player chat in the
workspace. Runs as a Vercel cron, so no machine of yours has to stay on.

## What it detects

| State | Rule | Why it matters |
|---|---|---|
| **Waiting on us** | The player spoke last and nobody has replied for `UNANSWERED_HOURS` | The worst case. A player asked something and got nothing back. |
| **Gone quiet** | No message either way for `QUIET_DAYS` | The reactivation list Shane asked for. |
| **Ignoring us** | The host is still posting but the player has not spoken in `QUIET_DAYS` | Outreach is going out and not landing. Invisible without message history. |
| **Left** | A leave action after the player's last message, or no player message on record, corroborated by member count | Not a quiet player, a gone one. Alerted separately so nobody wastes a re-engagement offer. |
| **Unhosted** | The chat belongs to a host who no longer hosts | The player still exists and nobody is assigned to them. Dashboard only. |
| **Unhappy** | Sentiment is negative or the player is signalling churn | A player can be in regular contact and still on the way out. Silence alone never catches that. |
| **Dormant** | Silent 90 days or more | Kept off the alerts so the live signal stays readable. |

## Facts about this API that the code encodes

These were established against production and are easy to lose:

- **`chat_id` is the Telegram id, never the workspace UUID.** The UUID returns
  `400 Telegram rejected the message request`.
- **`isOut` cannot tell you whether we replied.** It is relative to the account
  making the request. Reading as `@Thrill_VIP_Ops`, a message Colton sent from
  his own account comes back `isOut=false`, identical to a player message. Who
  spoke is decided by sender Telegram id against `config/staff.json`, with the
  `| Thrill` naming convention as a fallback for hosts not yet in the roster.
- **Message history is only readable for chats the reader account belongs to.**
  Other hosts' accounts return `CANONICAL_ACCOUNT_GRANT_REVOKED`, and that is
  account membership rather than a key or scope problem: OAuth as an admin
  returns the same two accounts. Adding `@Thrill_VIP_Ops` to a group is what
  makes that group readable.
- **The chat list still answers "who spoke last" without history**, because it
  carries `lastMessage.sender.id`. That is the fallback tier for chats we
  cannot read, and it is why coverage gaps degrade the detail rather than the
  detection.
- **Events are duplicated per connected account.** The same `messageId` appears
  once per account that can see it, so anything built on `/v1/events` has to
  dedupe on chat plus message id. History retention is about 30 days.
- **`actionType` does not say who the action was performed on**, so a
  `chatDeleteUser` alone cannot separate the player leaving from a host being
  rotated off. Member count corroborates: these groups hold a stable staff set
  plus one player, so one below the norm is the player.
- **Custom fields are mostly empty.** `player_username` is set on some chats and
  `tier` on almost none, so the player name is parsed from the chat title and
  the custom fields are treated as enrichment when present. Where both existed
  they agreed.
- **Scope is a naming convention.** Hosted players are groups of 25 or fewer
  whose title matches "x Thrill" in either ordering. That is 1248 chats. The
  other 2300 are public community groups the affiliate account sits in, affiliate
  deal rooms, channels and bots, and none of them belong in a player alert.

## Sentiment

Two passes. Rules run on every chat with fresh text, cost nothing, and catch
what is unambiguous here: unresolved withdrawals, scam accusations, an explicit
goodbye, a rival named as a destination. A model pass then runs only on chats
whose player has said something new since the last score, capped by
`SENTIMENT_BUDGET`, batched several chats per call.

The provider is whichever key is set, so switching from OpenAI to Anthropic
later is an env change and nothing else. With no key at all the rules still
run and everything else still works.

Message text is passed to the model and dropped. Only the label and a
one-line reason are stored, so player conversations never reach KV, the
snapshot or the dashboard.

Why the model pass earns its cost, from a real chat in this workspace: a player
explained he had been playing at a competitor, was losing there, wanted to come
back, and asked for a bonus. He was declined, said thanks, and has not spoken
since. Keyword rules score that neutral, because the only rival mention is
attached to him leaving the rival rather than leaving us. It is a churn case
and reads as one in context.

## Design decisions worth keeping

**The first run does not post the backlog.** 877 of the 1248 chats were already
past the quiet threshold on day one. Posting those would have buried the live
signal permanently, so the first scan seeds the baseline, posts one summary, and
alerts only on crossings after that. The backlog lives on the dashboard.

**A failed scan is not an empty queue.** Zero quiet players from a broken API
looks exactly like nobody having gone quiet, so consecutive failures are counted
and announced.

**Alerts fire once per player per threshold**, at 7, 30 and 90 days, not every
tick. Dedupe is keyed on chat plus state plus tier in KV.

**History is budgeted, not exhaustive.** A chat whose last message has not moved
since it was last read cannot have changed, so it is skipped and its stored
timestamps are reused. Only chats that actually moved cost an API call.

**A conversation the player closed is not a conversation waiting on a reply.**
An exchange that ends with the player saying thanks reads as "player messaged,
nobody replied" forever if you only compare timestamps. Short acknowledgements
close the exchange, and the chat falls through to the silence rules instead.

**Byron's chats are unhosted, not quiet.** He is no longer hosting, so his
players are not slow to reply, they have nobody assigned. Different problem,
kept off the alerts.

## Setup

1. Entergram key with `workspace.read`, `accounts.read`, `contacts.read`,
   `chats.read`, `messages.read`, `members.read`, `custom_fields.read`,
   `events.read`. **Leave the IP allowlist empty**, Vercel egress is not fixed.
2. `.env.local` from `.env.example`, then `npm install`.
3. `npm test` to check the rules, `probe.bat` / `probe2.bat` / `probe3.bat` for
   live recon, `build-roster.bat` to rebuild the staff roster.

## Access

The dashboard is behind Google SSO restricted to @paradym.io, the same
next-auth setup as sonar-kyt, so there is one auth pattern across these tools.
`/api/snapshot` is the only route that serves player data and it requires a
session. `/api/health` answers liveness unauthenticated and needs `?deep=1`
plus a session for anything descriptive. `/api/cron/scan` is machine-called and
uses `CRON_SECRET` rather than SSO.

Google Cloud Console setup is identical to sonar-kyt: OAuth consent screen User
Type Internal, authorised redirect URI `https://<domain>/api/auth/callback/google`.

## Deploy

```
npm install
vercel link
vercel env add ENTERGRAM_API_KEY production
vercel env add SLACK_BOT_TOKEN production
vercel env add SLACK_CHANNEL_ID production
vercel env add CRON_SECRET production
vercel env add OPENAI_API_KEY production
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add NEXTAUTH_SECRET production        # openssl rand -base64 32
vercel env add NEXTAUTH_URL production           # https://<your-vercel-domain>
vercel --prod
```

Add the Upstash Redis (KV) integration from the Vercel dashboard and connect it
to this project, which sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without
it there is nowhere to record what has already been alerted and every tick
re-alerts everything.

`CRON_SECRET` is not optional. Without it the cron route returns 401 to
everyone including Vercel. An unauthenticated endpoint that reads player
conversations and posts to Slack is worse than a broken cron, so it refuses to
run open.

### Environment

| Variable | What |
|---|---|
| `ENTERGRAM_API_KEY` | PRO key from Settings > Developers |
| `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` | The bot must be invited to the channel |
| `CRON_SECRET` | Any long random string, Vercel sends it as a bearer token |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Set by the Upstash integration |
| `QUIET_DAYS` | Default 7 |
| `UNANSWERED_HOURS` | Default 12 |
| `HISTORY_BUDGET` | History reads per run, default 150 |
| `OUTAGE_ALERT_AFTER_FAILURES` | Default 5 |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Sentiment. Whichever is set picks the provider |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | SSO, OAuth client in the paradym.io Workspace |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | SSO session signing and callback base |
| `ALLOWED_HD` | Default paradym.io |

### First run

`/api/cron/scan?dry=1` with the bearer token runs the whole thing and posts
nothing. Worth doing once before letting the schedule take over.

## Coverage

History is readable for the chats `@Thrill_VIP_Ops` belongs to. Everything else
falls back to the chat list, which still detects silence and who spoke last but
cannot separate "the player is ignoring us" from "we are ignoring the player".
Adding that account to the remaining groups closes the gap, and the scan picks
them up on the next run with no code change.
