# Entergram Watch

Watches every hosted player chat in the Entergram workspace, posts one Slack
alert per player when they have had nothing from us for seven days, and serves
a dashboard of outreach coverage, response times and player sentiment. Runs as
a Vercel cron every five minutes.

## What Slack gets

| Alert | When | Repeats |
|---|---|---|
| 7 days without contact | A hosted player crosses seven days without a message from any staff member | Once per silence. Re-armed only after we speak to the player again |
| Churn signal | A player's own messages read as at risk (unresolved withdrawal, scam accusation, naming a rival, saying goodbye) and nobody has answered yet | Once, then again only for a newer message at least a week later. `URGENT_ALERTS=off` disables it |

Everything else lives on the dashboard: players waiting on a reply, players not
answering our outreach, players who left, chats whose host no longer hosts. A
chat with no message either way for 20 days is time-barred: out of the
worklist, off the alerts, in its own tab.

Posting is paced at one message a second, honours `Retry-After`, and is capped
per run (`MAX_ALERTS_PER_RUN`, default 15) with one overflow line pointing at
the queue. The record of a posted alert is written to KV before the next one
goes out, so a failure later in the run can never cause a repeat. A restart
seeds a baseline instead of posting the backlog: only silences that cross the
line after the seed post.

## What the dashboard shows

**Overview.** Hosted players, share contacted in the last seven days, players
past seven days without contact, players waiting on a reply, unhappy players,
median and p90 time to first reply. Every figure opens the matching set in the
queue. A by-host table, the distribution of days since we last spoke, mood,
state, reply-time distribution and a daily trend.

**Queue.** Three tabs: Active (the worklist), Time-barred, Left and
unhosted. Filters are URL parameters, so any view is a link:
`/queue?f=no_contact`, `/queue?host=Colton`, `/queue?mood=at_risk`,
`/queue?tab=barred`, `/queue?chat=<telegram id>`. Clicking a row opens the player: host and their
share of our messages, when each side last spoke, reply times, sentiment with
the quote it was read from, alerts sent, and the recent conversation read live
from Entergram (never stored).

**Hosts.** Per person: players, contacted in seven days, no contact, waiting,
unhappy, ignoring, median and p90 reply. Plus unattributed players, unhosted
chats and unreadable groups. Senders that look like staff but are not in the
team table are listed with their Telegram id.

**Activity.** Every scan with its mode, duration and outcome; every alert
posted; consecutive failures.

## How a chat is read

**Scope.** Player chats are groups of 25 or fewer whose title matches
"<player> x Thrill" in either ordering. Affiliate rooms, partnerships,
channels and community groups are excluded. The workspace list carries one
entry per connected account that knows a group, so entries are collapsed onto
the Telegram id before anything else happens.

**Who spoke.** `isOut` is relative to the account making the request and
cannot tell staff from player. Every sender resolves against
`config/team.json` by Telegram user id, then exact display name, then the
"<name> | Thrill" convention. The shared @Thrill_VIP_Ops account is staff but
nobody in particular. A sender seen across six or more separate player groups
is treated as staff and listed on the Hosts page until added to the table.

**Host.** The hosting team member with the most messages in the group, recent
speech first. Groups are worked as a pool, so the drawer shows every staff
member active in the chat and the primary host's share. A chat whose only
staff speaker no longer hosts is unhosted. Where history cannot be read, the
owner of a personal connected account stands in; the shared account resolves
to nobody.

**Facts and state.** A history read establishes facts (last player message,
last staff message, whether the player closed the exchange, whether the player
left, host, reply times) and those are persisted per chat. The state a chat is
in is derived from facts and the clock on every tick, so it never flips between
runs and never needs a re-read to update.

**The event stream.** History can only be read for groups the reader account
belongs to. `/v1/events` has no such limit: every message in the workspace
appears there once per connected account that can see it, with the chat, the
sender's Telegram id, the time and the direction, and no text. The scan
follows it by cursor a few pages per tick (a first run backfills
`EVENTS_BACKFILL_DAYS`), collapses the per-account copies on chat, time and
sender, and keeps the last 80 turns per player chat. For groups whose text is
unreadable that gives who spoke last, reply times and the host; what it cannot
give is acknowledgements, departures and sentiment. Chats with neither history
nor stream turns fall back to the chat list, where a last message from us dates
our silence exactly and a last message from the player bounds it from below.

**Acknowledgements.** A player signing off with thanks is not waiting on a
reply, and a thank-you does not open a reply-time window.

**Sentiment.** Read from the end of the conversation: the exchange in the
hour before the player's last message, never fewer than their last three
messages, and nothing after it. Rules run on that window with the newest
message weighted most, and a complaint in the last message is never cancelled
by an earlier thank-you. The model reads the same exchange in order, with the
host's lines marked as context, and judges the player's mood at the end of it;
chats that only got the rules are caught up on later ticks. Text is passed to
the model and dropped; only the label, the reason and the line the verdict
rests on are stored.

## The scan

Full sweep hourly: every chat, the book rebuilt, invite links refreshed.
Incremental every other tick: only chats changed since the last tick
(`updated_since`), merged into the book. History is read for chats that moved,
for chats never read, and for a rotation through chats whose facts are older
than `ROTATION_HOURS`. Groups the reader account cannot see are retried daily
or when they move. A lock in KV stops overlapping runs; a soft deadline stops
reads and alerts in time to persist.

Consecutive failures are counted in KV and announced in Slack after
`OUTAGE_ALERT_AFTER_FAILURES`; recovery is announced once.

## Setup

1. Entergram PRO key with `workspace.read`, `accounts.read`, `contacts.read`,
   `chats.read`, `messages.read`, `members.read`, `custom_fields.read`,
   `events.read`. Leave the IP allowlist empty.
2. `.env.local` from `.env.example`, `npm install`, `npm test`.
3. `npm run dryrun` runs one scan against the live workspace with nothing
   posted or persisted and prints what it would do. `dryrun.bat` on Windows.

Message history is readable only for groups @Thrill_VIP_Ops is a member of.
Adding the account to a group makes it readable on the next scan.

## Access

The dashboard is behind Google SSO restricted to @paradym.io, the same
next-auth setup as sonar-kyt. `/api/snapshot`, `/api/history` and
`/api/chat/<id>` require a session. `/api/health` answers liveness
unauthenticated and needs `?deep=1` plus a session for anything descriptive.
`/api/cron/scan` uses `CRON_SECRET` as a bearer token; `?mode=full` forces a
full sweep, `?dry=1` posts and persists nothing.

## Deploy

```
npm install
vercel link
vercel env add ENTERGRAM_API_KEY production
vercel env add SLACK_BOT_TOKEN production
vercel env add SLACK_CHANNEL_ID production
vercel env add DASHBOARD_URL production
vercel env add CRON_SECRET production
vercel env add OPENAI_API_KEY production
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add NEXTAUTH_SECRET production
vercel env add NEXTAUTH_URL production
vercel --prod
```

Add the Upstash Redis integration from the Vercel dashboard so
`KV_REST_API_URL` and `KV_REST_API_TOKEN` are set. State is kept under `ew2:`
keys; keys from the previous version expire on their own.

### Environment

| Variable | What |
|---|---|
| `ENTERGRAM_API_KEY` | PRO key from Settings > Developers |
| `ENTERGRAM_READER_ACCOUNT_ID` | Overrides the reader account in `config/team.json` |
| `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` | The bot must be invited to the channel |
| `DASHBOARD_URL` | Public URL used in alert links, falls back to `NEXTAUTH_URL` |
| `CRON_SECRET` | Bearer token for the cron route |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Set by the Upstash integration |
| `QUIET_DAYS` | Default 7 |
| `UNANSWERED_HOURS` | Default 12 |
| `TIME_BARRED_DAYS` | Default 20 |
| `EVENTS_PAGES_PER_TICK` / `EVENTS_BACKFILL_DAYS` | Event stream pages per tick and how far the first run backfills, default 25 / 10 |
| `URGENT_ALERTS` | `on` (default) or `off` |
| `MAX_ALERTS_PER_RUN` | Default 15 |
| `OUTAGE_ALERT_AFTER_FAILURES` | Default 3 |
| `FULL_SWEEP_MINUTES` | Default 60 |
| `HISTORY_BUDGET` / `HISTORY_BUDGET_FULL` | History reads per incremental tick / full sweep, default 80 / 150 |
| `ROTATION_HOURS` | Default 6 |
| `STAFF_MIN_CHATS` | Distinct groups before an unknown sender counts as staff, default 6 |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Sentiment. Whichever is set picks the provider |
| `SENTIMENT_BUDGET` | Model-scored chats per run, default 40 |
| `SENTIMENT_WINDOW_MINUTES` / `SENTIMENT_MIN_MESSAGES` | The exchange the mood is read from: minutes before the player's last message, minimum player messages. Default 60 / 3 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | SSO |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | SSO session signing and callback base |
| `ALLOWED_HD` | Default paradym.io |

## Team table

`config/team.json` is the single source of truth for who is staff and who
hosts. Each member carries `telegramUserIds`, `senderNames`,
`telegramUsernames`, personal `accounts`, and `hosting: false` for staff whose
messages are ours but who never become a player's host. New hosts go here;
the Hosts page lists unresolved senders with the id to add.
