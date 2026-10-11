// Response helpers shared by every server function.

// Keep in sync with the Content-Security-Policy in public/_headers: that file
// covers the static pages, this one the pages and API answers from Functions
// (Cloudflare doesn't apply _headers to Functions).
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://i.ytimg.com",
  "frame-src 'self' https://www.youtube-nocookie.com",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

export function baseHeaders(extra = {}) {
  return {
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': CSP,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra
  };
}

export function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: baseHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      ...extra
    })
  });
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: baseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra
    })
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
