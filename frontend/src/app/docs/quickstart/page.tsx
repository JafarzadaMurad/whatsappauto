import Link from "next/link";
import { DocsPageHeader, DocsSection, Callout, Code, CodeBlock, Step, ExampleBox, Bubble } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "Quickstart — alChatBot Docs" };

export default function QuickstartPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Quickstart"
                title="Ship your first AI reply in 10 minutes"
                blurb="This walk-through takes you from zero to a working AI agent answering WhatsApp messages. It covers registration, adding an OpenAI (or Claude/Gemini/GLM) key, creating an agent, connecting a channel, and testing." />

            <DocsSection id="prereqs" title="What you need before you start">
                <ul>
                    <li>An email address you can receive a verification code at.</li>
                    <li>An API key from one AI provider — OpenAI, Anthropic, Google Gemini, or Z.ai (GLM). You can add more later.</li>
                    <li>A WhatsApp Business phone number ready to scan a QR code <em>or</em> an Instagram Business account.</li>
                </ul>
                <Callout kind="tip">
                    <p>If you only want to try the platform without connecting a real channel, you can build and test an agent in the built-in Sandbox — no channel required.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="step-1" title="Step 1 — Create your account">
                <Step n={1} title="Register at chatbot.tural.ai">
                    <p>Open <Code>https://chatbot.tural.ai/register</Code>, enter your name, email, and password. Confirm the verification code sent to your email.</p>
                </Step>
                <Step n={2} title="You&apos;re dropped into your workspace">
                    <p>Your first workspace is created automatically. Every resource — channels, agents, contacts, automations — belongs to this workspace. You can invite teammates later from <Code>/dashboard/admin/users</Code>.</p>
                </Step>
            </DocsSection>

            <DocsSection id="step-2" title="Step 2 — Add an AI provider key">
                <p>
                    Agents need a model to run against. Open <Code>/dashboard/ai/providers</Code> and add a key for at least one provider.
                    Keys are stored per workspace — every agent in the workspace can use any configured provider.
                </p>
                <Step n={1} title="Get an API key">
                    <p>
                        Follow the provider&apos;s dashboard link below and copy a fresh API key. You only need one to get started — most people begin with OpenAI (gpt-5) or Anthropic (claude-opus-4-7).
                    </p>
                    <ul>
                        <li><strong>OpenAI</strong>: <Code>platform.openai.com/api-keys</Code></li>
                        <li><strong>Anthropic</strong>: <Code>console.anthropic.com/settings/keys</Code></li>
                        <li><strong>Google Gemini</strong>: <Code>aistudio.google.com/apikey</Code></li>
                        <li><strong>Z.ai (GLM)</strong>: <Code>z.ai/manage-apikey/apikey-list</Code></li>
                    </ul>
                </Step>
                <Step n={2} title="Paste it into AI Providers">
                    <p>Pick the provider, paste the key, and hit <strong>Save</strong>. The next dropdown lets you pick which models this key can serve — leave the defaults or trim to the ones you actually plan to use.</p>
                </Step>
            </DocsSection>

            <DocsSection id="step-3" title="Step 3 — Create your first agent">
                <Step n={1} title="Open AI Agents">
                    <p>Go to <Code>/dashboard/ai/agents</Code> → <strong>New agent</strong>.</p>
                </Step>
                <Step n={2} title="Fill in the basics">
                    <ul>
                        <li><strong>Name</strong>: something short (e.g. &ldquo;Support Bot&rdquo;).</li>
                        <li><strong>Provider</strong>: pick the one you added above.</li>
                        <li><strong>Model</strong>: pick your favourite — <Code>gpt-5</Code>, <Code>claude-opus-4-7</Code>, <Code>gemini-2.5-pro</Code>, <Code>glm-4.6</Code>.</li>
                        <li><strong>Timezone</strong>: pick the one your customers are in (e.g. <Code>Asia/Baku</Code>). This drives the <Code>{`{{date}}`}</Code>/<Code>{`{{time}}`}</Code> placeholders.</li>
                    </ul>
                </Step>
                <Step n={3} title="Write a system prompt">
                    <p>The system prompt shapes the agent&apos;s voice, scope, and rules. Start simple:</p>
                    <CodeBlock lang="system prompt">{`You are the support assistant for Acme Coffee, a small speciality-coffee shop in Baku.

Speak in the customer's language (Azerbaijani, Russian, or English). Keep replies under two short sentences unless the customer asks for details.

Today is {{day}}, {{date}} at {{time}} ({{timezone}}). The customer is chatting via {{channel}}.

Rules:
- Answer product, price, and opening-hours questions.
- Never invent stock information — if you don't know, say you'll check with the team.
- For orders, ask for the customer's address and confirm.`}</CodeBlock>
                    <Callout kind="tip">
                        <p>The <Code>{`{{placeholders}}`}</Code> get replaced with real values every time the agent answers. Full list on the <Link className="underline" href="/docs/agents#variables">Agents page</Link>.</p>
                    </Callout>
                </Step>
                <Step n={4} title="Save and test">
                    <p>Hit <strong>Save</strong>. Now open the built-in <strong>Sandbox</strong> tab and type a message as if you were a customer. The agent replies live using the same code that will handle real messages.</p>
                </Step>
            </DocsSection>

            <DocsSection id="step-4" title="Step 4 — Connect a channel">
                <p>An agent alone doesn&apos;t receive customer messages. You need to link at least one channel. Pick whichever is easier:</p>

                <h4 className="font-semibold mt-6 mb-2">WhatsApp (fastest — no Meta approval needed)</h4>
                <Step n={1} title="Open WhatsApp">
                    <p>Go to <Code>/dashboard/whatsapp</Code> → <strong>Add instance</strong>. Give it a name like &ldquo;Support number&rdquo;.</p>
                </Step>
                <Step n={2} title="Scan the QR">
                    <p>A QR appears. On your phone, open <strong>WhatsApp → Settings → Linked Devices → Link a device</strong> and scan the QR. Status flips to <strong>Connected</strong> within a couple of seconds.</p>
                </Step>
                <Step n={3} title="Bind the agent">
                    <p>On the instance card, set <strong>Primary agent</strong> to the agent you created. From now on every message this number receives goes through the agent.</p>
                </Step>

                <h4 className="font-semibold mt-6 mb-2">Instagram (needs a Business/Creator account)</h4>
                <p>See <Link className="underline" href="/docs/channels#instagram">Channels → Instagram</Link> for the full OAuth walk-through.</p>
            </DocsSection>

            <DocsSection id="step-5" title="Step 5 — Send a real message">
                <p>From another WhatsApp account, send a message to your connected number. Watch the reply arrive within seconds.</p>
                <ExampleBox title="What you should see">
                    <Bubble side="in" label="Customer">Salam, sabah 10:00-da açıqsınız?</Bubble>
                    <Bubble side="out" label="Support Bot">Salam! Bəli, biz sabah 10:00-dan 22:00-a qədər açığıq. Nə sifariş vermək istəyirsiniz?</Bubble>
                </ExampleBox>
                <p>Every conversation shows up in real time in the shared inbox at <Code>/dashboard/inbox</Code>. Human teammates can jump in whenever they want — the agent respects the takeover automatically.</p>
            </DocsSection>

            <DocsSection id="next" title="What&apos;s next?">
                <ul>
                    <li><Link className="underline" href="/docs/skills">Enable skills</Link> — give the agent memory, CRM tools, or a Google Calendar.</li>
                    <li><Link className="underline" href="/docs/automations">Build an automation</Link> — trigger on keywords or comments and branch on quick-reply buttons.</li>
                    <li><Link className="underline" href="/docs/channels">Add more channels</Link> — Instagram DMs, comments, or click-to-message Facebook Ads.</li>
                </ul>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
