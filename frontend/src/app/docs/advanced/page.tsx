import Link from "next/link";
import { DocsPageHeader, DocsSection, DocsSubSection, Callout, Code, CodeBlock, Step } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "Advanced — alChatBot Docs" };

export default function AdvancedPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Advanced"
                title="Router agents, oversight, API access, and more"
                blurb="Everything that isn't in the day-one workflow: multi-agent routing, quality oversight, programmatic access, MCP, and custom AI providers. Skim what you need — nothing here is required to run the platform." />

            <DocsSection id="router-agents" title="Router agents">
                <p>
                    A router is a special agent whose job is to <em>dispatch</em> — read the customer&apos;s first message, pick the specialist agent
                    that should handle the conversation, and hand off. The specialist then owns the conversation from that point forward
                    (sticky routing).
                </p>

                <DocsSubSection id="ra-when" title="When to use">
                    <ul>
                        <li>Multi-product businesses where different agents know different catalogues.</li>
                        <li>Split Sales / Support agents so each has a focused system prompt.</li>
                        <li>Multi-language teams — a router picks the language-matched specialist on the first message.</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="ra-setup" title="Setup">
                    <Step n={1} title="Create the specialist agents">
                        <p>Regular agents — one per intent / language / product. Fill in short <strong>Router description</strong> fields on each; the router reads these to decide who to pick.</p>
                    </Step>
                    <Step n={2} title="Create the router agent">
                        <p>Go to <Code>/dashboard/ai/routers</Code> → <strong>New router</strong>. Router agents have <Code>isRouter=true</Code> — this unlocks the <Code>handoffTo</Code> and <Code>unassignAgent</Code> tools.</p>
                    </Step>
                    <Step n={3} title="Pick which specialists it can dispatch to">
                        <p>The <strong>Routable agents</strong> panel lets you allow-list which specialists this router can pick. Empty list = every workspace sibling is fair game.</p>
                    </Step>
                    <Step n={4} title="Bind the router to a channel">
                        <p>On the WhatsApp/Instagram instance card, set <strong>Router agent</strong> instead of Primary agent. The router handles the first turn, calls <Code>handoffTo(agentId)</Code>, and the picked specialist takes over.</p>
                    </Step>
                </DocsSubSection>

                <Callout kind="tip">
                    <p>Once a contact is assigned to a specialist, they <em>stay</em> with that specialist even after the router agent is retired or reconfigured. Use <Code>unassignAgent</Code> from any specialist to send them back through the router.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="oversight" title="Oversight agents">
                <p>
                    An oversight agent reviews a sample of every regular agent&apos;s replies and flags issues you&apos;d have missed — awkward
                    phrasing, off-topic answers, missed handoff opportunities. Think of it as a QA teammate that reads every conversation.
                </p>
                <DocsSubSection id="ov-setup" title="Setup">
                    <ul>
                        <li>Go to <Code>/dashboard/oversight</Code>.</li>
                        <li>Create an oversight agent — pick a model (any provider), describe what you&apos;re looking for.</li>
                        <li>Point it at one or more of your regular agents.</li>
                    </ul>
                </DocsSubSection>
                <DocsSubSection id="ov-review" title="Reviewing suggestions">
                    <p>Oversight suggestions land in a queue on the same page. You can <strong>Approve</strong> a suggestion — the fix is auto-applied to the reviewed agent&apos;s system prompt — or <strong>Reject</strong> to dismiss.</p>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="api-keys" title="API Keys">
                <p>Every workspace can mint API keys for programmatic access — perfect for internal automation, custom UIs, or piping data into a warehouse.</p>
                <DocsSubSection id="api-scope" title="Scope">
                    <p>Keys inherit the creator&apos;s workspace access. Rotate or revoke from <Code>/dashboard/api-keys</Code>.</p>
                </DocsSubSection>
                <DocsSubSection id="api-use" title="Using a key">
                    <p>Include it as a bearer token in the Authorization header:</p>
                    <CodeBlock lang="bash">{`curl -H "Authorization: Bearer sk-... " \\
     https://chatbot.tural.ai/api/agents`}</CodeBlock>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="webhooks" title="Webhooks">
                <p>Subscribe to workspace events and receive them on a URL you control. Useful when you want to pipe conversations into an external analytics tool, sync contacts to your own CRM, or trigger downstream workflows.</p>
                <DocsSubSection id="wh-events" title="Event types">
                    <ul>
                        <li><Code>message.new</Code> — a new inbound or outbound message.</li>
                        <li><Code>client.updated</Code> — a CRM contact was created or changed.</li>
                        <li><Code>automation.executed</Code> — an automation ran.</li>
                    </ul>
                </DocsSubSection>
                <DocsSubSection id="wh-setup" title="Setup">
                    <p>Add a webhook at <Code>/dashboard/webhooks</Code>. Pick the events you want and a URL. Payloads are POSTed as JSON; retries with exponential backoff on non-2xx responses.</p>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="mcp" title="MCP (Model Context Protocol)">
                <p>Expose your alChatBot workspace to LLM clients like Claude Desktop via MCP. Once connected, Claude can search contacts, read conversations, and even send messages on your behalf.</p>
                <DocsSubSection id="mcp-connect" title="Connect Claude Desktop">
                    <p>Go to <Code>/dashboard/mcp</Code>. Copy the MCP server URL, then in Claude Desktop go to <strong>Settings → Connectors → Add MCP server</strong> and paste it. You&apos;ll be prompted to authorise with your alChatBot account.</p>
                </DocsSubSection>
                <Callout kind="info">
                    <p>MCP is designed for personal use — reviewing conversations, extracting insights, drafting replies from your desktop. For production automation, use API keys + webhooks instead.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="providers" title="Custom AI providers">
                <p>The default AI providers cover most cases — but if you need Azure OpenAI, a self-hosted LLM, or a niche provider with an OpenAI-compatible API, you can add it as a custom provider.</p>
                <DocsSubSection id="providers-add" title="Adding a custom provider">
                    <p>On <Code>/dashboard/ai/providers</Code>, click <strong>Add custom</strong>. You&apos;ll be asked for:</p>
                    <ul>
                        <li><strong>Name</strong> — displayed everywhere else.</li>
                        <li><strong>Base URL</strong> — the OpenAI-compatible endpoint (e.g. <Code>https://your-azure-openai.openai.azure.com/openai/deployments/gpt-5</Code>).</li>
                        <li><strong>API Key</strong> — bearer token.</li>
                        <li><strong>Model list</strong> — which model ids to expose in the agent dropdown.</li>
                    </ul>
                </DocsSubSection>
                <Callout kind="warning">
                    <p>Custom providers must implement the OpenAI Chat Completions API surface, including tool-calling. Providers that don&apos;t support tool calls will crash on any agent with skills enabled.</p>
                </Callout>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
