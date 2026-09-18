// API routes plus one dashboard page.
//
// optimizeFonts is off deliberately. Next inlines Google Fonts at build time,
// which makes every deploy depend on fonts.googleapis.com being reachable from
// the builder. The <link> in _document loads the face at runtime instead.
export default { reactStrictMode: true, optimizeFonts: false };
