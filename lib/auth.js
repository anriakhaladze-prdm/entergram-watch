// Google SSO restricted to one Workspace domain. Same shape as sonar-kyt, so
// there is one auth pattern across these tools rather than two.
//
// Defence in depth:
//   1. The authorization URL passes hd=<domain>, so Google filters the account
//      picker to @paradym.io accounts.
//   2. The signIn callback re-checks the email suffix server side. The hd claim
//      can be tampered with by an attacker proxying the OAuth flow, and
//      Workspace alias domains can make hd differ from the real email domain,
//      so only the suffix is trusted.
//   3. OAuth consent screen User Type = Internal, set in Google Cloud Console,
//      is the primary restriction. The two above are belt and braces.
// next-auth v4 ships CommonJS, and this package is `"type": "module"`. Under
// ESM resolution its named exports arrive on the namespace's `default`, so a
// plain `import { getServerSession }` binds undefined and every route using it
// 500s at load with "r is not a function". Unwrapping here keeps the rest of
// the project on ESM, which the scripts and the scan engine need.
import GoogleProviderModule from 'next-auth/providers/google';
import * as NextAuthNext from 'next-auth/next';

const GoogleProvider = GoogleProviderModule.default ?? GoogleProviderModule;
const getServerSession = NextAuthNext.getServerSession ?? NextAuthNext.default?.getServerSession ?? NextAuthNext.default;

const ALLOWED_HD = (process.env.ALLOWED_HD || 'paradym.io').toLowerCase();

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      authorization: {
        params: { hd: ALLOWED_HD, prompt: 'select_account', access_type: 'online', scope: 'openid email profile' },
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email ? String(profile.email).toLowerCase() : '';
      if (email.endsWith('@' + ALLOWED_HD)) return true;
      return '/auth/denied?reason=domain';
    },
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      if (profile?.name) token.name = profile.name;
      return token;
    },
    async session({ session, token }) {
      if (token?.email) session.user = { ...(session.user || {}), email: token.email };
      if (token?.name) session.user = { ...(session.user || {}), name: token.name };
      return session;
    },
  },
  pages: { signIn: '/auth/signin', error: '/auth/denied' },
};

// For API routes. Returns the session, or writes the 401 itself and returns
// null so the caller can early-return.
export async function requireSession(req, res) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email ? String(session.user.email).toLowerCase() : '';
  if (!session || !email.endsWith('@' + ALLOWED_HD)) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return session;
}
