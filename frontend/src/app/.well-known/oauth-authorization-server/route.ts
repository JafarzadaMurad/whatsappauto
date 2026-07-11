// RFC 8414 OAuth 2.0 Authorization Server Metadata at the host root.
// Forwarded to our backend so the canonical document is the same.

export async function GET() {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://chatbot.tural.ai';
    return Response.json({
        issuer: base,
        authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
        token_endpoint: `${base}/api/mcp/oauth/token`,
        registration_endpoint: `${base}/api/mcp/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    });
}
