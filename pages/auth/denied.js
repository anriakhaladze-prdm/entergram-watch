import Head from 'next/head';
import Script from 'next/script';
import { useRouter } from 'next/router';
import { signIn } from 'next-auth/react';

export default function Denied() {
  const { query } = useRouter();
  const message = query.reason === 'domain'
    ? 'That account is not on the paradym.io workspace.'
    : query.reason === 'blocked' || query.reason === 'access'
      ? 'That account does not have access.'
      : 'Sign in could not be completed.';

  return (
    <>
      <Head><title>Access denied · Sonar</title></Head>
      <div className="sg-root">
        <canvas className="sg-field" aria-hidden="true" />

        <div className="sg-mark">
          <span className="sg-wordmark" role="img" aria-label="Sonar" />
        </div>

        <main className="sg-card">
          <p className="sg-eyebrow typ-label-small">Thrill&rsquo;s Back Office</p>
          <h1 className="sg-title typ-heading-large">Login to Sonar</h1>

          <a
            className="sg-btn typ-label-medium"
            href="/api/auth/signin/google"
            onClick={(e) => { e.preventDefault(); signIn('google', { callbackUrl: '/' }); }}
          >
            Login with SSO
          </a>

          <p className="sg-error typ-label-small" role="alert">{message}</p>

          <p className="sg-foot typ-paragraph-xsmall">
            SSO only. If you don&rsquo;t have access, contact Thrill&rsquo;s system administrator.
          </p>
        </main>
      </div>
      <Script src="/signin.js" strategy="afterInteractive" />
    </>
  );
}
