// Entergram PRO public API client.
//
// Auth is a workspace-scoped key in `X-API-Key`. Everything this watcher needs
// is read-only: workspace.read, accounts.read, contacts.read, chats.read,
// messages.read, members.read.
//
// Two chat views exist and they are not interchangeable:
//   GET /v1/workspace/chats  shared CRM view, deduplicated across every
//                            connected account. This is the one to scan.
//   GET /v1/live/chats       actor-owned transport view, scoped to one
//                            connected account. Used only when a chat has to
//                            be resolved back to the account that can read it.
//
// Message history is always scoped to an account: /v1/chats/{id}/messages
// requires `account_id`, and the account has to be one that is actually in
// that chat or it returns nothing.

const DEFAULT_BASE = 'https://api.entergram.com';
const MAX_ATTEMPTS = 4;

export class EntergramError extends Error {
  constructor(message, { status, detail, path } = {}) {
    super(message);
    this.name = 'EntergramError';
    this.status = status;
    this.detail = detail;
    this.path = path;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ apiKey, baseUrl, fetchImpl } = {}) {
  const key = apiKey || process.env.ENTERGRAM_API_KEY;
  const base = (baseUrl || process.env.ENTERGRAM_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const doFetch = fetchImpl || globalThis.fetch;
  if (!key) throw new EntergramError('ENTERGRAM_API_KEY is not set');

  async function request(path, { params = {}, method = 'GET', body = null } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }

    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res;
      try {
        res = await doFetch(url, {
          method,
          headers: {
            'X-API-Key': key,
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        // Network-level failure. Retry, then give up loudly: a swallowed
        // failure here reads downstream as "nobody has gone quiet".
        lastErr = new EntergramError(`network error: ${e.message}`, { path });
        if (attempt < MAX_ATTEMPTS) { await sleep(backoff(attempt)); continue; }
        throw lastErr;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        lastErr = new EntergramError(`HTTP ${res.status}`, { status: res.status, path });
        if (attempt < MAX_ATTEMPTS) {
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
          continue;
        }
        throw lastErr;
      }

      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }

      if (!res.ok) {
        // Errors come back as application/problem+json.
        const detail = parsed?.detail || parsed?.error?.message || parsed?.title || text.slice(0, 300);
        throw new EntergramError(`HTTP ${res.status} on ${path}: ${detail}`, { status: res.status, detail, path });
      }
      return parsed;
    }
    throw lastErr;
  }

  function backoff(attempt) {
    return Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
  }

  // Offset pagination. `data.pagination.hasMore` / `nextOffset` drive it;
  // `total` is present but not trusted as the loop condition.
  async function pageAll(path, { params = {}, pageSize = 200, maxPages = 200 } = {}) {
    const items = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const res = await request(path, { params: { ...params, limit: pageSize, offset } });
      const batch = res?.data?.items || [];
      items.push(...batch);
      const pg = res?.data?.pagination;
      if (!pg?.hasMore || batch.length === 0) break;
      offset = pg.nextOffset ?? offset + batch.length;
    }
    return items;
  }

  return {
    request,
    pageAll,

    me: () => request('/v1/me'),
    workspace: () => request('/v1/workspace'),

    accounts: async () => (await request('/v1/accounts'))?.data?.items || [],
    members: (params = {}) => pageAll('/v1/members', { params }),
    contacts: (params = {}) => pageAll('/v1/contacts', { params }),
    groups: (params = {}) => pageAll('/v1/groups', { params }),
    groupMembers: (groupId, params = {}) =>
      pageAll(`/v1/groups/${encodeURIComponent(groupId)}/members`, { params }),

    // The scan surface. `updated_since` is an RFC3339 lower bound on snapshot
    // or last-message date, so it narrows an incremental pass but must be left
    // off for the full sweep that finds long-silent chats.
    workspaceChats: (params = {}) => pageAll('/v1/workspace/chats', { params }),
    workspaceChat: (chatId) => request(`/v1/workspace/chats/${encodeURIComponent(chatId)}`),
    liveChats: (params = {}) => pageAll('/v1/live/chats', { params }),

    // Newest first, 100 per page, walked backwards with before_message_id.
    messages: async (chatId, accountId, { limit = 100, beforeMessageId } = {}) => {
      const res = await request(`/v1/chats/${encodeURIComponent(chatId)}/messages`, {
        params: { account_id: accountId, limit, before_message_id: beforeMessageId },
      });
      return {
        items: res?.data?.items || [],
        hasMore: Boolean(res?.data?.hasMore),
        oldestMessageId: res?.data?.oldestMessageId ?? null,
        accountId: res?.data?.accountId ?? accountId,
      };
    },

    // Cursor stream. Cheap way to learn what changed since the last run
    // without re-reading history for every chat.
    events: async ({ after = 0, limit = 500, direction, updatedSince } = {}) => {
      const res = await request('/v1/events', {
        params: { after, limit, direction, updated_since: updatedSince },
      });
      return {
        items: res?.data?.items || [],
        hasMore: Boolean(res?.data?.hasMore),
        nextCursor: res?.data?.nextCursor ?? after,
      };
    },

    customColumns: async () => (await request('/v1/custom-columns'))?.data?.items || [],
    chatCustomFields: (chatId) => request(`/v1/chats/${encodeURIComponent(chatId)}/custom-fields`),
  };
}
