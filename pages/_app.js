import Head from 'next/head';
import { SessionProvider } from 'next-auth/react';
// The Thrill back-office design system, copied verbatim from the bulk outreach
// tool so both screens are the same screen. thrill.css carries the tokens and
// the typ-* scale, components.css the shell, grid, badges and controls,
// signin.css the shared sign-in screen. outreach.css holds only what this tool
// adds on top, built from the same tokens.
import '../styles/thrill.css';
import '../styles/components.css';
import '../styles/signin.css';
import '../styles/outreach.css';

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <Head><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
      <Component {...pageProps} />
    </SessionProvider>
  );
}
