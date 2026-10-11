// GET /.well-known/oauth-protected-resource(/mcp)  →  points MCP clients at the sign-in server
import { protectedResourceMetadata, oauthJson, preflight } from '../../../lib/oauth.js';

export const onRequestGet = ({ request }) => oauthJson(protectedResourceMetadata(request));
export const onRequestOptions = preflight;
