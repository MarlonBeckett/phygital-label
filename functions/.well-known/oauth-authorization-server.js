// GET /.well-known/oauth-authorization-server  →  tells MCP clients how to sign in
import { authorizationServerMetadata, oauthJson, preflight } from '../../lib/oauth.js';

export const onRequestGet = ({ request }) => oauthJson(authorizationServerMetadata(request));
export const onRequestOptions = preflight;
