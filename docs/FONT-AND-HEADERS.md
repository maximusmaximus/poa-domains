# Domain font and browser security

The explorer uses the bundled color font only for domain text: domain links,
ideas, the search/name fields, ticker name spans, detail names and the existing
escrow listing headings. Ordinary text, branding, amounts, principals and controls
use system fonts. The font program is **unchanged** (1,856,988 bytes). Its immutable
URL is `domain-emoji.a5ec1ef950064a71.woff2`, whose prefix is checked against SHA-256.
The old filename remains a non-immutable compatibility alias, never referenced by
current CSS. The two paths reuse the same Git/content blob; no font subset or
emoji artwork is changed.

The CSS range is the exact union of the pinned Unicode 17 `TEST_ROWS` code points,
not the old broad U+203C–3299 interval. Tests retain keycap bases/combiner, VS16,
ZWJ, skin tones and tag flags, while excluding ordinary → and ✕. A visible emoji
domain still legitimately downloads the whole font once; default Find contains
emoji ideas. A shell/view with no visible domain names downloads **no** bundled
font. No font is preloaded or content hidden just to satisfy a byte budget.

## Headers

`src/ui-policy.ts` defines the header-only Worker/Node boundary. `_headers` matches
it for asset-first traffic; real workerd tests check both paths. No body, status,
RPC/request shape, escrow implementation/configuration or browser-write admission
rule changes. In particular, public JSON/discovery CORS is preserved, but HTML
has no wildcard CORS.

- CSP `connect-src 'self'`: the browser's actual origin, not a hardcoded backend.
  Both workers.dev and the Grok Build front door use relative same-origin APIs.
  Native minepoa reads remain server-side and are unaffected by browser CSP.
- HSTS `max-age=31536000`, deliberately without includeSubDomains/preload on shared
  hosting. The Grok Build front door already adds its own HSTS with
  includeSubDomains; that existing stronger edge policy is not changed. Local
  HTTP ignores HSTS normally.
- COOP `same-origin`, with **no COEP/CORP** that could break public read clients.
  There is no popup-based signing/OAuth flow in this UI.
- Permissions disable camera/microphone/geolocation/payment and explicitly keep
  `clipboard-write=(self)` for cart/escrow copy buttons.
- Fingerprinted font: `public, max-age=31536000, immutable`. HTML is revalidated;
  APIs/MCP/escrow retain their existing no-store policy. Static non-font assets
  use normal must-revalidate caching, never a year-long mutable-URL cache.

Read-only GitHub Pages keeps its separate strict meta CSP with the two exact
public minepoa observation URLs. We do not claim custom HTTP headers on GitHub
Pages, where this repository cannot configure them.

## Evidence and boundaries

`test/ui-perf-browser.mjs` measures decoded resource bytes, not CWV/Lighthouse or
compressed real-user transfer: cold shell <65 KB, domain-free Handoff <750 KB,
and Find including its one complete font <2.6 MB. Chromium/Firefox/WebKit verify
zero ordinary-UI font requests, exactly one hashed request for an emoji domain,
and no repeat font bytes reaching the fixture server. Firefox can reuse its
native font cache without a ResourceTiming entry, so server counters and loaded
FontFace state are checked too. Results: `test-results/ui-perf-results.json`.

A same-origin reverse-proxy fixture exercises the real app under the enforced
headers, clipboard and an intentionally blocked arbitrary-HTTPS fetch. WebKit
emits one `style-src-attr` event for its native SELECT even in the no-script probe;
the app must match that exact element/directive baseline. No application script,
font or connection violation is ignored and CSP is not relaxed. Title staggering
is static CSS rather than inline style mutation.

Forty real-workerd header contracts cover both host names, escrow on/off and exact
public packet forwarding, MCP Accept/Origin/body handling and deep links. The
unchanged escrow monetary/UI suite remains mandatory (mock chain only), as do
all escrow coverage lanes. After the Max-reviewed deploy, both public hosts are
checked again for headers, immutable font bytes/cache, UI/escrow mount, MCP and
unchanged live policy/bindings. Known upstream freshness holds remain informational
per Max's November 9 instruction; binding or health/UI/MCP failure means rollback.

References: [Cloudflare asset headers](https://developers.cloudflare.com/workers/static-assets/headers/),
[Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/),
[unicode-range](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/unicode-range),
[COOP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy).
