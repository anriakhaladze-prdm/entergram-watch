import NextAuthModule from 'next-auth';
import { buildAuthOptions, requestContext } from '../../../lib/auth.js';

// Same CommonJS interop as lib/auth.js: the callable lives on `default`.
const NextAuth = NextAuthModule.default ?? NextAuthModule;

// Built per request so the sign-in callbacks can record the device and
// address a session was opened from.
export default function handler(req, res) {
  return NextAuth(req, res, buildAuthOptions(requestContext(req)));
}
