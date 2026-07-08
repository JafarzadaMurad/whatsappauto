import Link from "next/link";
import { DocsPageHeader, DocsSection, DocsSubSection, Callout, Code, CodeBlock, ExampleBox, Bubble } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "Agent Skills — alChatBot Docs" };

export default function SkillsPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Agent Skills"
                title="Every skill, explained"
                blurb="Skills are what turn a language model into a working assistant. Each checkbox in the Skills panel gives the agent one or more tools, plus a short built-in prompt telling it how to use them. This page covers every skill in detail." />

            <Callout kind="info" title="How skills work">
                <p>Enabling a skill does two things:</p>
                <ol>
                    <li>Registers a set of <strong>tools</strong> (functions the model can call).</li>
                    <li>Appends a <strong>built-in prompt</strong> that explains how to use them.</li>
                </ol>
                <p>You can override the built-in prompt from the skill&apos;s config panel — the panel opens automatically when you tick a skill&apos;s box.</p>
            </Callout>

            <DocsSection id="memory" title="Memory">
                <p>
                    Lets the agent look back through prior messages on demand. Without this skill, the agent only sees the last N turns
                    (set by <Link className="underline" href="/docs/agents#history">History depth</Link>). With Memory on, older context
                    is reachable via search and range fetches.
                </p>
                <DocsSubSection id="memory-tools" title="Tools">
                    <ul>
                        <li><Code>conversationStats</Code> — total turn count, first-message date, last message.</li>
                        <li><Code>searchMessages(query, limit?)</Code> — full-text search inside this conversation.</li>
                        <li><Code>getMessages(from, to)</Code> — fetch a range of turns by index (1 = oldest).</li>
                        <li><Code>getMessagesAround(turnIdx, radius?)</Code> — grab context around a specific turn.</li>
                    </ul>
                </DocsSubSection>
                <DocsSubSection id="memory-when" title="When to enable">
                    <ul>
                        <li>Long-running conversations where old details matter (medical follow-ups, ongoing sales cycles).</li>
                        <li>Any use case where the customer casually references &ldquo;last week&rdquo; or &ldquo;that thing I asked about&rdquo;.</li>
                    </ul>
                </DocsSubSection>
                <Callout kind="tip">
                    <p>Combined with a shrunk History depth (e.g. 3), Memory dramatically reduces per-turn cost while keeping the whole conversation reachable when needed.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="self-pause" title="Self-pause">
                <p>
                    Gives the agent a way to hand a conversation off to a human by pausing itself for the current contact.
                    Once paused, the agent stops replying to that contact until an operator resumes them from the inbox.
                </p>
                <DocsSubSection id="self-pause-tools" title="Tools">
                    <ul>
                        <li><Code>pauseAgent({`{ reason: string }`})</Code> — pause auto-replies for this contact. The reason is saved to the CRM record as an audit trail.</li>
                    </ul>
                </DocsSubSection>
                <DocsSubSection id="self-pause-when" title="When to enable">
                    <p>Almost always. It&apos;s a safety valve: hostile customer, deal that&apos;s ready for a human closer, ambiguity that only a person can resolve.</p>
                </DocsSubSection>
                <ExampleBox title="System-prompt hint">
                    <CodeBlock lang="prompt fragment">{`If the customer is asking to speak with a person, is visibly upset, or needs a decision only management can make, call pauseAgent with a one-line reason. After that, write ONE polite handoff line ("A colleague will get back to you shortly") and stop.`}</CodeBlock>
                </ExampleBox>
            </DocsSection>

            <DocsSection id="crm" title="CRM Management">
                <p>Lets the agent create and update contact records — the foundation of &ldquo;pre-qualified leads&rdquo; hitting your sales team&apos;s inbox already tagged and tagged.</p>
                <DocsSubSection id="crm-tools" title="Tools">
                    <ul>
                        <li><Code>upsertClient({`{...}`})</Code> — create or update a contact by phone. Sets name, status, tags, summary.</li>
                        <li><Code>getClient(phone)</Code> — look up an existing contact.</li>
                        <li><Code>searchClients(query)</Code> — find contacts by name or phone.</li>
                    </ul>
                </DocsSubSection>
                <Callout kind="tip" title="Contacts auto-upsert on first message">
                    <p>Even without this skill, alChatBot creates a Client row for every new sender. The skill just lets the agent enrich that row (tag, status, summary) automatically.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="user-fields" title="User Fields">
                <p>
                    Custom fields you define on the Contacts page (age, city, plan, budget…) — the agent can read and write them
                    just like normal contact attributes. Combine with a <Link className="underline" href="/docs/inbox#custom-fields">field schema</Link>
                    to build powerful qualification flows.
                </p>
                <DocsSubSection id="uf-tools" title="Tools">
                    <ul>
                        <li><Code>listUserFields()</Code> — schema of available fields.</li>
                        <li><Code>setUserField(key, value)</Code> — save a value on the current contact.</li>
                        <li><Code>getUserField(key)</Code> — recall a saved value.</li>
                        <li><Code>searchContactsByField(key, value)</Code> — find contacts matching a filter.</li>
                    </ul>
                </DocsSubSection>
                <ExampleBox title="Example — qualification flow">
                    <Bubble side="in">Salam, saytım üçün proqramçı axtarıram.</Bubble>
                    <Bubble side="out">Salam! Sizin sahə nədir və proqramçınız neçə ay ərzində lazımdır?</Bubble>
                    <Bubble side="in">İT startap, 2 ay sonra.</Bubble>
                    <p className="text-xs text-muted-foreground italic">Agent calls setUserField(&quot;industry&quot;, &quot;IT startup&quot;) and setUserField(&quot;timeline&quot;, &quot;2 months&quot;).</p>
                    <Bubble side="out">Anladım. Sizin təxmini büdcəniz nə qədərdir?</Bubble>
                </ExampleBox>
            </DocsSection>

            <DocsSection id="tables" title="Data Tables">
                <p>
                    Custom tables you upload on the <Code>/dashboard/ai/tables</Code> page — perfect for price lists, product catalogues,
                    FAQ archives, or team rosters. Agents search across rows and answer the customer with the right entry.
                </p>
                <DocsSubSection id="tables-tools" title="Tools">
                    <ul>
                        <li><Code>listTables()</Code> — enumerate available tables in this workspace.</li>
                        <li><Code>searchTable(tableId, query)</Code> — full-text search on the table&apos;s content.</li>
                        <li><Code>getTableRows(tableId, from, to)</Code> — read a specific range.</li>
                    </ul>
                </DocsSubSection>
                <Callout kind="tip" title="Prefer tables over long system prompts">
                    <p>If your system prompt is stuffed with menu items or a price list, move them into a Data Table. The prompt stays clean, and tables update independently — no re-testing the whole agent when prices change.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="http" title="HTTP API Requests">
                <p>Lets the agent call your own APIs — Bitrix, Notion, an in-house billing service, whatever. You define the tools upfront as templates; the agent picks the right one and fills in parameters.</p>
                <DocsSubSection id="http-tools" title="Configuration">
                    <p>Open the HTTP skill panel and click <strong>+ Add tool</strong>. Each tool has:</p>
                    <ul>
                        <li><strong>Name</strong> — a JavaScript-safe identifier (e.g. <Code>createBitrixLead</Code>).</li>
                        <li><strong>Description</strong> — 1–2 lines the model reads when deciding whether to call it.</li>
                        <li><strong>Method</strong>, <strong>URL</strong>, <strong>Headers</strong>, <strong>Body</strong> — the actual HTTP call. Supports Handlebars-style placeholders for parameters.</li>
                        <li><strong>Parameters</strong> — the schema the model must satisfy (each parameter has a name, description, and type).</li>
                    </ul>
                </DocsSubSection>
                <ExampleBox title="Example — Bitrix lead creation">
                    <CodeBlock lang="config">{`Name:        createBitrixLead
Description: Create a new lead in Bitrix CRM. Use after the customer confirms name and phone.
Method:      POST
URL:         https://your-bitrix.bitrix24.eu/rest/1/xyz.../crm.lead.add.json
Headers:     Content-Type: application/json
Body:        {"fields":{"TITLE":"{{title}}","NAME":"{{name}}","PHONE":[{"VALUE":"{{phone}}","VALUE_TYPE":"WORK"}]}}
Parameters:
  - title  (string) — Short lead title, e.g. "Website inquiry".
  - name   (string) — Customer's full name.
  - phone  (string) — Customer's phone in E.164, e.g. +994551234567.`}</CodeBlock>
                </ExampleBox>
                <Callout kind="warning">
                    <p>HTTP tools fire even in the Sandbox — that&apos;s intentional so you can test the integration. Use throwaway data if you don&apos;t want real records created.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="live-operators" title="Live Operators">
                <p>
                    Lets the agent ping a human teammate over WhatsApp when it doesn&apos;t know something, wait for their reply,
                    and then forward the answer back to the customer.
                </p>
                <DocsSubSection id="lo-tools" title="Tools">
                    <ul>
                        <li><Code>listOperators()</Code> — enumerate available operators.</li>
                        <li><Code>askOperator({`{ operatorId, question }`})</Code> — ping the operator with the question. The system delivers their reply back to the customer automatically.</li>
                    </ul>
                </DocsSubSection>
                <DocsSubSection id="lo-config" title="Configuration">
                    <p>The skill&apos;s config panel is where you add operators. Each operator has:</p>
                    <ul>
                        <li><strong>Name</strong> — shown to the agent when it decides who to ask.</li>
                        <li><strong>WhatsApp phone</strong> — digits only, e.g. <Code>994551234567</Code>.</li>
                        <li><strong>Order</strong> — the pinging sequence. If operator #1 doesn&apos;t reply within their timeout, alChatBot forwards to operator #2.</li>
                        <li><strong>System prompt</strong> — optional, describes their role so the agent knows what to ask them.</li>
                    </ul>
                </DocsSubSection>
                <ExampleBox title="Example — customer asks about custom pricing">
                    <Bubble side="in">10 000 ədəd üçün endirim varmı?</Bubble>
                    <Bubble side="out" label="Agent → operator">Aygün müəllim, müştəri 10 000 ədəd üçün endirim soruşur. Cavab verə bilərsiniz?</Bubble>
                    <p className="text-xs text-muted-foreground italic">The operator replies on WhatsApp: &ldquo;Bəli, 15% endirim təklif edirik.&rdquo;</p>
                    <Bubble side="out" label="Agent → customer">Yeni məlumat aldım — 10 000 ədəd üçün 15% endirim təklif edirik. Sifariş vermək istəyirsiniz?</Bubble>
                </ExampleBox>
            </DocsSection>

            <DocsSection id="polls" title="Polls">
                <p>
                    Lets the agent send native WhatsApp polls with 2–12 options. The customer taps a choice, and the vote arrives
                    as the next user message with the option&apos;s label — the agent handles it like any other reply.
                </p>
                <DocsSubSection id="polls-tools" title="Tools">
                    <ul>
                        <li><Code>sendPoll({`{ name, options, multi? }`})</Code> — sends a poll.</li>
                    </ul>
                </DocsSubSection>
                <Callout kind="warning" title="No chat text with the poll">
                    <p>WhatsApp shows the poll as its own bubble. If the agent sends both a chat message and a poll in the same turn, the customer sees both at once — usually redundant. The built-in prompt reminds the model to write NOTHING else on poll turns.</p>
                </Callout>
                <Callout kind="tip">
                    <p>For richer branching (poll options that each trigger a different downstream flow), use a <Link className="underline" href="/docs/automations#poll-branch">poll node in an Automation</Link> instead — the agent&apos;s poll skill is best for lightweight in-conversation choices.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="google-calendar" title="Google Calendar (Connector)">
                <p>Adds three tools that let the agent check availability and book meetings on the workspace&apos;s connected Google Calendar. Requires a workspace-level connection — see <Link className="underline" href="/docs/connectors">Connectors</Link>.</p>
                <DocsSubSection id="gc-tools" title="Tools">
                    <ul>
                        <li><Code>listCalendarEvents({`{ timeMin, timeMax, q? }`})</Code> — check what&apos;s on the calendar between two ISO timestamps.</li>
                        <li><Code>createCalendarEvent({`{ summary, start, end, timezone?, attendeeEmails? }`})</Code> — book a slot.</li>
                        <li><Code>cancelCalendarEvent({`{ eventId }`})</Code> — remove a booking.</li>
                    </ul>
                </DocsSubSection>
                <ExampleBox title="Example — booking a consultation">
                    <Bubble side="in">Sabah saat 15:00 üçün konsultasiya bron edə bilərəm?</Bubble>
                    <p className="text-xs text-muted-foreground italic">Agent calls listCalendarEvents(timeMin: 2026-07-09T14:00:00+04:00, timeMax: 2026-07-09T16:00:00+04:00) — slot is free.</p>
                    <Bubble side="out">Bəli, sabah 15:00 boşdur. Adınızı və e-poçtunuzu təsdiq edin, sizin üçün Calendar-a qeyd edim.</Bubble>
                    <Bubble side="in">Aygün Rəhimova, aygun@example.com</Bubble>
                    <p className="text-xs text-muted-foreground italic">Agent calls createCalendarEvent(summary: &quot;Konsultasiya — Aygün Rəhimova&quot;, start: 2026-07-09T15:00:00+04:00, end: 2026-07-09T15:30:00+04:00, attendeeEmails: [&quot;aygun@example.com&quot;]).</p>
                    <Bubble side="out">✓ Bron edildi — sabah 15:00–15:30. Google Calendar-dan dəvətnamə e-poçtunuza gələcək.</Bubble>
                </ExampleBox>
                <Callout kind="warning" title="ISO timestamps with timezone">
                    <p>The tools require full ISO strings <em>with timezone offset</em>. The agent&apos;s <Link className="underline" href="/docs/agents#timezone">Timezone</Link> setting drives the offset — set it correctly for your customers.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="reminder" title="Reminder (background)">
                <p>
                    Not a runtime tool — this skill enables a <strong>background scheduler</strong> that sends a warm follow-up when a contact
                    has gone silent for a configurable number of hours (default 24). Perfect for re-engaging leads who ghosted.
                </p>
                <DocsSubSection id="reminder-config" title="Configuration">
                    <ul>
                        <li><strong>Reminder hours</strong> — how many hours of silence trigger the follow-up (default 24, max 720 / 30 days).</li>
                    </ul>
                </DocsSubSection>
                <Callout kind="info">
                    <p>Only contacts that are <em>not</em> agent-paused are eligible. Paused conversations remain silent — the whole point of pausing is to hand off to a human.</p>
                </Callout>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
