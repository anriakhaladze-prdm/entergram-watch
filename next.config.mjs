// API routes plus one dashboard page.
//
// optimizeFonts is off deliberately. Next inlines Google Fonts at build time,
// which makes every deploy depend on fonts.googleapis.com being reachable from
// the builder. The <link> in _document loads the face at runtime instead.
export default {
  reactStrictMode: true,
  optimizeFonts: false,
  // pdfkit loads its built-in font metrics through a package "imports" alias
  // inside a wrapped require, which the deploy tracer cannot follow, so the
  // export route's bundle has to be told to carry them. The key is a glob:
  // written literally, the [id] would read as a character class.
  experimental: { outputFileTracingIncludes: { '/api/export/*': ['./node_modules/pdfkit/js/**'] } },
};
