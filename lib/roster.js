// Who owns which connected account, derived rather than hand-listed.
//
// The chat list only names the Telegram account that knows a chat
// ("ColtonThrill", "mikeythrillaffiliate"), which is not a person: those two
// belong to Colton and to Kaleb D respectively, and a display name is not
// something to guess identity from. /v1/groups carries the link: every group
// lists knownByAccounts with an ownerUserId, and /v1/members turns that id
// into a name, an email and a workspace role.
//
// Deriving it means a host who joins next month is picked up on the next
// scan instead of silently landing in "unhosted" because a config file in
// this repo had never heard of them.
import inactive from '../config/inactive-hosts.json' with { type: 'json' };

const INACTIVE = new Map((inactive.members || []).map((m) => [m.userId, m]));

export async function buildRoster(api, { groupPages = 8, pageSize = 200 } = {}) {
  const members = await api.members();
  const membersById = new Map(members.map((m) => [m.userId, {
    userId: m.userId,
    name: m.user?.displayName || m.displayAlias || null,
    email: m.user?.email || null,
    role: m.role || null,
  }]));

  // One pass over the groups is enough to see every account that owns player
  // chats; the tail is community groups and repeats the same accounts.
  const accountsById = new Map();
  // Telegram's own link to the group, when Entergram has it cached. It is the
  // only link into a chat the API offers, and for somebody already in the
  // group it opens the conversation rather than joining it.
  const links = new Map();
  for (let page = 0; page < groupPages; page++) {
    const res = await api.request('/v1/groups', { params: { limit: pageSize, offset: page * pageSize } });
    const items = res?.data?.items || [];
    for (const g of items) {
      if (g.inviteLink && g.groupId) links.set(String(g.groupId), g.inviteLink);
      for (const a of g.knownByAccounts || []) {
        if (!a.accountId || accountsById.has(a.accountId)) continue;
        const owner = a.ownerUserId ? membersById.get(a.ownerUserId) : null;
        accountsById.set(a.accountId, {
          accountId: a.accountId,
          username: a.username || null,
          displayName: a.displayName || null,
          ownerUserId: a.ownerUserId || null,
          ownerName: owner?.name || a.ownerDisplayName || null,
          ownerEmail: owner?.email || null,
          ownerRole: owner?.role || null,
          // Inactive is a human fact the API cannot know: Byron is still an
          // admin of the workspace, he just does not host any more. Keyed on
          // the person, not the account, so it survives them reconnecting.
          active: !(a.ownerUserId && INACTIVE.has(a.ownerUserId)),
          inactiveReason: a.ownerUserId ? INACTIVE.get(a.ownerUserId)?.reason || null : null,
        });
      }
    }
    if (!res?.data?.pagination?.hasMore) break;
  }

  return {
    builtAt: new Date().toISOString(),
    accounts: [...accountsById.values()],
    members: [...membersById.values()],
    links: Object.fromEntries(links),
  };
}

export function rosterIndex(roster) {
  return new Map((roster?.accounts || []).map((a) => [a.accountId, a]));
}
