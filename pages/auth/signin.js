import Head from 'next/head';
import Script from 'next/script';
import { signIn } from 'next-auth/react';

// The shared back-office sign-in screen. Markup is exactly what signin.css
// documents, so this screen is the same one the other tools show; the
// rippling dot field is /signin.js, dropped in unchanged.
export default function SignIn() {
  return (
    <>
      <Head><title>Sign in · Sonar</title></Head>
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

          <p className="sg-foot typ-paragraph-xsmall">
            SSO only. If you don&rsquo;t have access, contact Thrill&rsquo;s system administrator.
          </p>
        </main>
      </div>
      <Script src="/signin.js" strategy="afterInteractive" />
    </>
  );
}
