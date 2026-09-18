import { useRouter } from 'next/router';
import { signIn } from 'next-auth/react';
import Head from 'next/head';

export default function Denied() {
  const { query } = useRouter();
  const domain = query.reason === 'domain';
  return (
    <>
      <Head><title>Access denied · Player outreach</title></Head>
      <div className="gate">
        <div className="gate-card">
          <div className="gate-title">Access denied</div>
          <div className="gate-sub">
            {domain ? 'That account is not on the paradym.io workspace.' : 'Sign in could not be completed.'}
          </div>
          <button className="gate-btn" onClick={() => signIn('google', { callbackUrl: '/' })}>Try another account</button>
        </div>
      </div>
    </>
  );
}
