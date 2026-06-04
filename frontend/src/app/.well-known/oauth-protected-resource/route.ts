// RFC 9728 Protected Resource Metadata — points MCP clients to the
// authorization server that protects our /api/mcp endpoint.

export async function GET() {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://chatbot.tur.al';
    return Response.json({
        resource: `${base}/api/mcp`,
        authorization_servers: [base],
        scopes_supported: ['full'],
        bearer_methods_supported: ['header'],
    });
}
