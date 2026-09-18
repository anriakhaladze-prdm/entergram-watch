import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="dark light" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>
      {/* Oxanium is self-hosted via @font-face in thrill.css, so there is no
          Google Fonts request and no build-time dependency on it. */}
      <body className="thrill-dark-theme">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
