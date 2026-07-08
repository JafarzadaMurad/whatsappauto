import Link from "next/link";
import { DocsPageHeader, DocsSection, DocsSubSection, Callout, Code, CodeBlock, Step, ExampleBox, Bubble } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "AI Agents — alChatBot Docs" };

export default function AgentsPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="AI Agents"
                title="Create, configure, and test your agents"
                blurb="An agent is the smallest unit of automation on alChatBot. You pick a model, write a prompt, toggle skills, and connect it to a channel. This page covers everything you need to build one that actually works." />

            <DocsSection id="basics" title="The basics">
                <p>Every agent has:</p>
                <ul>
                    <li>A <strong>name</strong> — used to identify it in dropdowns and analytics.</li>
                    <li>An <strong>AI provider + model</strong> — pick from your workspace&apos;s configured providers.</li>
                    <li>A <strong>system prompt</strong> — the instructions that shape its voice, scope, and rules.</li>
                    <li>A set of <strong>skills</strong> — checkboxes that add tools to what the agent can do (see the <Link className="underline" href="/docs/skills">Skills chapter</Link>).</li>
                    <li>Optional settings — memory depth, timezone, Whisper language, voice/vision toggles.</li>
                </ul>
                <p>Everything is edited from <Code>/dashboard/ai/agents/&lt;id&gt;</Code>. Changes save when you click the yellow Save button (bottom-right) or hit <Code>Ctrl+S</Code>.</p>
            </DocsSection>

            <DocsSection id="model" title="Picking a model">
                <p>Model choice is the biggest cost/quality lever. alChatBot supports:</p>
                <ul>
                    <li><strong>OpenAI</strong> — GPT-5, GPT-4o, o-series reasoning models.</li>
                    <li><strong>Anthropic Claude</strong> — Opus 4.7, Sonnet 4.6, Haiku 4.5.</li>
                    <li><strong>Google Gemini</strong> — 2.5 Pro, 2.5 Flash.</li>
                    <li><strong>Z.ai (GLM)</strong> — GLM 4.6, 4-Air-Vision.</li>
                </ul>
                <Callout kind="tip" title="Which model should I start with?">
                    <p>
                        For most support/sales use cases, <strong>Claude Opus 4.7</strong> or <strong>GPT-5</strong> give the best balance of tone and reasoning.
                        Try <strong>Sonnet 4.6</strong> or <strong>GPT-4o</strong> if you need to keep costs down at scale — they&apos;re noticeably cheaper and still handle most conversations well.
                    </p>
                </Callout>
            </DocsSection>

            <DocsSection id="system-prompt" title="Writing a system prompt">
                <p>
                    The system prompt is the single most important control you have. It should describe:
                </p>
                <ol>
                    <li><strong>Who</strong> the agent is (the business it represents).</li>
                    <li><strong>How</strong> it should speak (tone, languages, length).</li>
                    <li><strong>What</strong> it&apos;s allowed to do (topics in scope; things to refuse).</li>
                    <li><strong>Handoff rules</strong> — when to escalate to a human or another agent.</li>
                </ol>

                <ExampleBox title="Example — support agent for a coffee shop">
                    <CodeBlock lang="system prompt">{`You are the support assistant for Acme Coffee, a small speciality-coffee shop in Baku.

Voice:
- Speak in the customer's language (Azerbaijani, Russian, or English) — mirror whichever they used first.
- Keep replies under two short sentences unless the customer asks for a detailed explanation.
- Friendly but professional. No slang.

Today is {{day}}, {{date}} at {{time}} ({{timezone}}). The customer is chatting via {{channel}}.

Scope:
- Answer questions about the menu, prices, opening hours, and location.
- Take orders for delivery inside Baku. Confirm address and phone before sending to the team.
- If asked about franchising or partnerships, say "Let me connect you with the founder" and call pauseAgent with a short summary.

Never invent details. If you don't know something (stock, weekend hours, a new promo), reply "Let me check with the team and get back to you", then call pauseAgent.`}</CodeBlock>
                </ExampleBox>

                <Callout kind="tip" title="Keep it under a page">
                    <p>Once your prompt is 300+ lines it becomes hard to maintain and models start to ignore parts of it. Move stable knowledge — menus, prices, FAQs — into a <Link className="underline" href="/docs/skills#tables">Data Table</Link> the agent can query on demand.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="variables" title="Prompt variables">
                <p>
                    The System Prompt supports placeholders that get replaced with fresh values on every model call. That way the agent
                    always knows what day it is, what channel the customer is on, and what timezone applies — without you re-editing the prompt.
                </p>

                <div className="my-4 overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/40 text-muted-foreground text-xs uppercase tracking-widest">
                            <tr>
                                <th className="text-left px-4 py-2 font-semibold">Placeholder</th>
                                <th className="text-left px-4 py-2 font-semibold">Example value</th>
                                <th className="text-left px-4 py-2 font-semibold">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="text-xs font-mono">
                            {[
                                ['{{channel}}',      'WhatsApp',              'WhatsApp / Instagram'],
                                ['{{date}}',         '08 July 2026',          'day + month name + year'],
                                ['{{day}}',          'Wednesday',             'weekday name'],
                                ['{{day_number}}',   '08',                    'day of month, zero-padded'],
                                ['{{month}}',        'July',                  'month name'],
                                ['{{month_number}}', '07',                    'month as number'],
                                ['{{year}}',         '2026',                  ''],
                                ['{{time}}',         '14:30',                 '24-hour local time'],
                                ['{{datetime}}',     '08 July 2026 14:30',    'combined date + time'],
                                ['{{iso_date}}',     '2026-07-08',            'yyyy-mm-dd (best-effort)'],
                                ['{{timezone}}',     'Asia/Baku',             'IANA zone selected on the agent'],
                            ].map(row => (
                                <tr key={row[0]} className="border-t border-border/50">
                                    <td className="px-4 py-2 text-primary">{row[0]}</td>
                                    <td className="px-4 py-2 text-foreground/80">{row[1]}</td>
                                    <td className="px-4 py-2 text-muted-foreground font-sans">{row[2]}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <Callout kind="tip">
                    <p>
                        In the editor, click any chip above the System Prompt textarea to insert the placeholder at the caret.
                        Unknown placeholders pass through untouched, so downstream skill prompts aren&apos;t corrupted if a
                        variable name has a typo.
                    </p>
                </Callout>
            </DocsSection>

            <DocsSection id="timezone" title="Timezone">
                <p>
                    The <strong>Timezone</strong> dropdown next to the System Prompt sets the IANA zone used to render <Code>{`{{date}}`}</Code>,
                    <Code>{`{{day}}`}</Code>, <Code>{`{{time}}`}</Code>. Pick the zone your customers are actually in — for a Baku-based business that&apos;s
                    <Code>Asia/Baku</Code>, for an Istanbul team it&apos;s <Code>Europe/Istanbul</Code>, and so on.
                </p>
                <p>
                    This is especially important when combined with the <Link className="underline" href="/docs/skills#google-calendar">Google Calendar skill</Link>:
                    the agent proposes and books slots in this timezone, so a mismatch leads to bookings in the wrong hour.
                </p>
            </DocsSection>

            <DocsSection id="history" title="History depth">
                <p>
                    Each turn, the agent sees the <em>last N messages</em> automatically. <strong>History depth</strong> controls N. Smaller values (3–5) force
                    the model to lean on the <Link className="underline" href="/docs/skills#memory">Memory skill</Link> for older context —
                    cheaper on tokens, slower to look things up. Larger values (10–20) hand the model more context for free but cost more per turn.
                </p>
                <p>Default is 10. Increase if the model keeps forgetting recent details; decrease if you&apos;re burning tokens on old chatter.</p>
            </DocsSection>

            <DocsSection id="voice-vision" title="Voice and vision">
                <ul>
                    <li>
                        <strong>Audio enabled</strong> (default on): incoming WhatsApp/Instagram voice notes are transcribed via Whisper before
                        the agent sees them. Without this, the agent gets a &ldquo;🎤 Audio&rdquo; placeholder and can&apos;t react to what was said.
                        Pick the customer&apos;s language in the <strong>Whisper language</strong> dropdown for the best accuracy.
                    </li>
                    <li>
                        <strong>Vision enabled</strong> (default on): incoming images are forwarded to the model as native image parts — perfect
                        for product photos or screenshots. Requires a vision-capable model (GPT-4o+, Claude 4.x, Gemini 2.x, GLM-4-Air-Vision).
                    </li>
                </ul>
            </DocsSection>

            <DocsSection id="testing" title="Testing an agent">
                <p>Every agent editor has three test tabs at the top:</p>
                <ul>
                    <li><strong>Sandbox</strong> — a scratch chat that doesn&apos;t write to real CRM records. Type as if you were a customer; watch tool calls and replies live.</li>
                    <li><strong>Conversations</strong> — search past real conversations across every channel this agent has handled.</li>
                    <li><strong>Usage</strong> — token counts, tool-call frequency, and cost estimates.</li>
                </ul>
                <Callout kind="tip">
                    <p>Sandbox uses a <em>dry-run</em> wrapper on write-tools like <Code>upsertClient</Code> and <Code>setUserField</Code>, so exploratory testing doesn&apos;t dirty real contacts. HTTP tools <em>do</em> fire — that&apos;s the whole point of testing them.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="active" title="Active vs Inactive">
                <p>
                    An agent has an <strong>Active</strong> toggle in the top-right of the editor. When set to <strong>Inactive</strong>,
                    the agent is skipped everywhere — channel default fallback, automation <Code>action_ai_reply</Code>, everything.
                    Useful for temporarily silencing an agent without deleting it.
                </p>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
