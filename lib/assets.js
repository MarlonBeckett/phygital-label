// Reads one of the site's own deployed files (labels, settings, uploads).
//
// The query string makes every read unique. On the live site's main address,
// Cloudflare was seen serving a deleted label's file from cache long after
// new deployments had removed it (the deployment's own address was correct).
// A fresh query string can't be answered from that cache.
export function readAsset(env, request, path, init) {
  const url = new URL(path, request.url);
  url.search = `?fresh=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return env.ASSETS.fetch(url, init);
}
