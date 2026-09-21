// Google SSO restricted to one Workspace domain. Same shape as sonar-kyt, so
// there is one auth pattern across these tools rather than two.
//
// Defence in depth:
//   1. The authorization URL passes hd=<domain>, so Google filters the account
//      picker to @paradym.io accounts.
//   2. The signIn callback decides on the address itself, server side: it has
//      to be on the allow-list (the monitoring whitelist, ALLOWED_EMAILS, or
//      the list managed under Logs) and not on a block-list. The hd claim can
//      be tampered with by an attacker proxying the OAuth flow, so it is only
//      a hint to the picker.
//   3. OAuth consent screen User Type = Internal, set in Google Cloud Console,
//      is the primary restriction. The two above are belt and braces.
//
// Sessions are JWTs. Each one is stamped with an id at sign-in and registered
// in the store with the device and address it came from, so the Logs section
// can list and revoke them; the session callback refuses a revoked id or a
// blocked address on every read, which is what ends a session that was open
// when the block was placed.
//
// next-auth v4 ships CommonJS, and this package is `"type": "module"`. Under
// ESM resolution its named exports arrive on the namespace's `default`, so a
// plain `import { getServerSession }` binds undefined and every route using it
// 500s at load with "r is not a function". Unwrapping here keeps the rest of
// the project on ESM, which the scripts and the scan engine need.
import { randomUUID } from 'node:crypto';
import GoogleProviderModule from 'next-auth/providers/google';
import * as NextAuthNext from 'next-auth/next';
import { ALLOWED_DOMAIN, isMonitor, clientIp, describeUa } from './access.js';
import { sessionRevoked, emailBlocked, emailAllowed, noteActivity } from './gate.js';
import { logSignIn, putSession, kvConfigured } from './state.js';

const GoogleProvider = GoogleProviderModule.default ?? GoogleProviderModule;
const getServerSession = NextAuthNext.getServerSession ?? NextAuthNext.default?.getServerSession ?? NextAuthNext.default;

const quiet = (p) => p.catch(() => {});

// ctx carries the request the NextAuth handler is serving (user agent and
// address), which the callbacks do not otherwise see. getServerSession calls
// pass nothing; only the sign-in path needs it.
export function buildAuthOptions(ctx = {}) {
  return {
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        authorization: {
          params: { hd: ALLOWED_DOMAIN, prompt: 'select_account', access_type: 'online', scope: 'openid email profile' },
        },
      }),
    ],
    session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
    callbacks: {
      async signIn({ profile }) {
        const email = profile?.email ? String(profile.email).toLowerCase() : '';
        const refuse = async (reason) => {
          if (kvConfigured() && email) await quiet(logSignIn({ email, name: profile?.name || '', at: Date.now(), denied: true, reason, ip: ctx.ip || '', device: ctx.device || '' }));
          return `/auth/denied?reason=${reason}`;
        };
        if (!email) return refuse('access');
        if (await emailBlocked(email)) return refuse('blocked');
        if (!(await emailAllowed(email))) return refuse('access');
        return true;
      },
      async jwt({ token, profile }) {
        if (profile?.email) token.email = profile.email;
        if (profile?.name) token.name = profile.name;
        if (profile && !token.sid) {
          token.sid = randomUUID();
          if (kvConfigured()) await quiet(putSession({ sid: token.sid, email: String(token.email || '').toLowerCase(), name: token.name || '', createdAt: Date.now(), lastSeen: Date.now(), ip: ctx.ip || '', device: ctx.device || '' }));
        }
        return token;
      },
      // Enforcement on every read: getServerSession runs this, so every API
      // route is covered, as is the client's useSession.
      async session({ session, token }) {
        const email = String(token?.email || session?.user?.email || '').toLowerCase();
        if (!email) return null;
        if (await emailBlocked(email)) return null;
        if (!(await emailAllowed(email))) return null;
        if (token?.sid && (await sessionRevoked(token.sid))) return null;
        session.user = { ...(session.user || {}), email, name: token?.name || session.user?.name || null };
        session.sid = token?.sid || null;
        session.monitor = isMonitor(email);
        if (token?.sid) noteActivity(token.sid);
        return session;
      },
    },
    events: {
      async signIn({ profile, user }) {
        const email = String(profile?.email || user?.email || '').toLowerCase();
        if (kvConfigured()) await quiet(logSignIn({ email, name: profile?.name || user?.name || '', at: Date.now(), ip: ctx.ip || '', device: ctx.device || '' }));
      },
    },
    pages: { signIn: '/auth/signin', error: '/auth/denied' },
  };
}

export const authOptions = buildAuthOptions();

export const requestContext = (req) => ({ ip: clientIp(req?.headers || {}), device: describeUa(req?.headers?.['user-agent']) });

// For API routes. Returns the session, or writes the 401 itself and returns
// null so the caller can early-return.
export async function requireSession(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return session;
}

// For the Logs routes: the monitoring whitelist only.
export async function requireMonitor(req, res) {
  const session = await requireSession(req, res);
  if (!session) return null;
  if (!isMonitor(session.user.email)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return session;
}
