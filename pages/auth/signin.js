import { signIn } from 'next-auth/react';
import Head from 'next/head';

export default function SignIn() {
  return (
    <>
      <Head><title>Sign in · Player outreach</title></Head>
      <div className="gate">
        <div className="gate-card">
          <div className="gate-title">Player outreach</div>
          <div className="gate-sub">Thrill.com · Entergram watch</div>
          <button className="gate-btn" onClick={() => signIn('google', { callbackUrl: '/' })}>
            Continue with Google
          </button>
          <div className="gate-note">Restricted to @paradym.io accounts</div>
        </div>
      </div>
    </>
  );
}
