// POST /mcp  →  the MCP server (Streamable HTTP, plain JSON responses).
// Claude connects here after signing in through /oauth/authorize.
import { passwordProblem } from '../lib/auth.js';
import { verifyBearer, origin, oauthJson, preflight, CORS } from '../lib/oauth.js';
import { TOOLS, SERVER_INFO, INSTRUCTIONS, callTool } from '../lib/mcp.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

async function handle(msg, env, siteOrigin) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return failure(msg && msg.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;
  const p = msg.params && typeof msg.params === 'object' ? msg.params : {};

  switch (msg.method) {
    case 'initialize':
      return result(msg.id, {
        protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    case 'ping':
      return result(msg.id, {});
    case 'tools/list':
      return result(msg.id, { tools: TOOLS });
    case 'tools/call':
      if (typeof p.name !== 'string') return failure(msg.id, -32602, 'Missing tool name');
      return result(msg.id, await callTool(env, siteOrigin, p.name, p.arguments && typeof p.arguments === 'object' ? p.arguments : {}));
    default:
      return failure(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function onRequestPost({ request, env }) {
  if (passwordProblem(env)) return oauthJson(failure(null, -32603, 'The site is not set up yet.'), 500);
  if (!(await verifyBearer(request, env))) {
    return oauthJson({ error: 'invalid_token', error_description: 'Connect again to sign in.' }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource/mcp"`
    });
  }

  let body;
  try { body = await request.json(); } catch (e) { return oauthJson(failure(null, -32700, 'Parse error'), 400); }
  const siteOrigin = origin(request);
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handle(m, env, siteOrigin)))).filter(Boolean);
    return replies.length ? oauthJson(replies) : new Response(null, { status: 202, headers: CORS });
  }
  const reply = await handle(body, env, siteOrigin);
  return reply ? oauthJson(reply) : new Response(null, { status: 202, headers: CORS });
}

// No server-to-client stream: every reply comes back on the POST.
export function onRequestGet() {
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', ...CORS } });
}
export const onRequestDelete = onRequestGet;
export const onRequestOptions = preflight;
