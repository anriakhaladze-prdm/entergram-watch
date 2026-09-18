import NextAuthModule from 'next-auth';
import { authOptions } from '../../../lib/auth.js';

// Same CommonJS interop as lib/auth.js: the callable lives on `default`.
const NextAuth = NextAuthModule.default ?? NextAuthModule;

export default NextAuth(authOptions);
