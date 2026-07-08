import Link from "next/link";
import { DocsPageHeader, DocsSection, DocsSubSection, Callout, Code, CodeBlock, Step, ExampleBox, Bubble } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "Automations — alChatBot Docs" };

export default function AutomationsPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Automations"
                title="Visual playbooks that actually branch"
                blurb="Chain triggers, filters, HTTP calls, quick-reply buttons, and agent hand-offs on a live canvas. Each button in a quick-reply message becomes its own output — the flow continues down whichever branch the customer picked." />

            <DocsSection id="editor" title="The editor">
                <p>
                    Every automation is a graph of <strong>nodes</strong> connected by <strong>edges</strong>. A node is either a <strong>trigger</strong> (starts the flow),
                    an <strong>action</strong> (does something), or a <strong>condition</strong> (branches). Open the editor at
                    <Code>/dashboard/automations/&lt;id&gt;</Code>.
                </p>
                <DocsSubSection id="editor-basics" title="Basics">
                    <ul>
                        <li>Click <strong>+ Add node</strong> to open the palette; nodes are grouped by channel (WhatsApp / Instagram / Generic).</li>
                        <li>Drag from a source handle (right side of a node) to a target handle (left side of another) to create an edge.</li>
                        <li>Click a node to open its config panel on the right.</li>
                        <li>Toggle <strong>Active</strong> in the top-left to enable / disable the automation without deleting it.</li>
                        <li>Hit <strong>Save</strong> (top-right) to persist changes. Nothing runs until you save.</li>
                    </ul>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="triggers" title="Triggers">
                <p>A trigger listens for a specific event. Every automation needs at least one.</p>
                <div className="my-4 overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/40 text-xs uppercase tracking-widest text-muted-foreground">
                            <tr>
                                <th className="text-left px-4 py-2 font-semibold">Trigger</th>
                                <th className="text-left px-4 py-2 font-semibold">Fires on</th>
                                <th className="text-left px-4 py-2 font-semibold">Config</th>
                            </tr>
                        </thead>
                        <tbody className="text-xs">
                            {[
                                ['WhatsApp · Keyword',  'Inbound WA DM matching keyword rules',       'instanceId (or any), keywords, matchMode, caseSensitive'],
                                ['WhatsApp · Any Message', 'Every inbound WA DM',                     'instanceId (or any)'],
                                ['WhatsApp · New Contact', 'First message from a phone we haven\'t seen', 'instanceId (or any)'],
                                ['Instagram · DM',      'Inbound IG DM — filter by keyword or any',  'accountId, filterMode (any/keyword), keywords'],
                                ['Instagram · New Contact', 'First IG DM from a new IGSID',           'accountId'],
                                ['Instagram · Post',    'New comment on a selected post',            'accountId, mediaId (or any), keywords (optional)'],
                            ].map(row => (
                                <tr key={row[0] as string} className="border-t border-border/50">
                                    <td className="px-4 py-2 font-mono">{row[0]}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{row[1]}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{row[2]}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <DocsSubSection id="triggers-match" title="Match modes for keyword triggers">
                    <ul>
                        <li><strong>contains</strong> (default) — the message contains the keyword anywhere.</li>
                        <li><strong>exact</strong> — the whole message equals the keyword (trimmed).</li>
                        <li><strong>starts</strong> — the message starts with the keyword.</li>
                        <li><strong>regex</strong> — the message matches the JavaScript regex you entered.</li>
                    </ul>
                    <p>Multiple keywords go on one line, comma-separated. Any match fires the trigger.</p>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="actions" title="Actions">
                <p>Actions do work. Wire an action node after a trigger — or after another action — via edges.</p>

                <div className="my-4 overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/40 text-xs uppercase tracking-widest text-muted-foreground">
                            <tr>
                                <th className="text-left px-4 py-2 font-semibold">Action</th>
                                <th className="text-left px-4 py-2 font-semibold">Purpose</th>
                            </tr>
                        </thead>
                        <tbody className="text-xs">
                            {[
                                ['WhatsApp · Send Message',   'Send text (with optional media) via the current WA instance.'],
                                ['WhatsApp · Send Poll',      'Send a native poll with 2–12 options — each option becomes a branch handle.'],
                                ['Instagram · Send DM',       'Send a text / media / quick-reply DM. Each quick-reply becomes a branch handle.'],
                                ['Instagram · Reply Comment', 'Post a public comment reply.'],
                                ['Instagram · Hide Comment',  'Hide the triggering comment.'],
                                ['Instagram · Delete Comment', 'Delete the triggering comment.'],
                                ['AI Agent Reply',            'Route this trigger to a specific AI agent — overrides the channel default.'],
                                ['Add Tag',                   'Tag the CRM contact for later filtering.'],
                                ['Set User Field',            'Save a value on a custom contact field.'],
                                ['HTTP Request',              'Call any external API. Store the response in a variable for downstream nodes.'],
                                ['Wait / Delay',              'Sleep for N seconds inside the flow.'],
                                ['Condition',                 'Branch true/false on a message/tag/status check.'],
                            ].map(row => (
                                <tr key={row[0] as string} className="border-t border-border/50">
                                    <td className="px-4 py-2 font-mono">{row[0]}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{row[1]}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </DocsSection>

            <DocsSection id="variables" title="Variables in text fields">
                <p>Every text field in every action supports variable placeholders. The chip palette above each input shows what&apos;s available for that specific node — click a chip to insert it at the caret.</p>

                <DocsSubSection id="var-trigger" title="From the trigger">
                    <p>Depending on the upstream trigger, these placeholders resolve at run time:</p>
                    <ul>
                        <li><Code>{`{{name}}`}</Code> / <Code>{`{{username}}`}</Code> — contact display name / IG @handle.</li>
                        <li><Code>{`{{message}}`}</Code> / <Code>{`{{comment}}`}</Code> — the text of the triggering message or comment.</li>
                        <li><Code>{`{{post_url}}`}</Code> — link to the post (comment triggers only).</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="var-http" title="From HTTP nodes">
                    <p>Every <strong>HTTP Request</strong> node has an <em>Output variable</em> field (e.g. <Code>apiResponse</Code>). Its value is the parsed response body — reference the whole thing with <Code>{`{{apiResponse}}`}</Code>, or reach into it with dotted paths:</p>
                    <CodeBlock lang="template">{`Hi {{name}}! Your latest order status is {{apiResponse.data.status}} — arriving on {{apiResponse.data.eta}}.`}</CodeBlock>
                    <p>The chip palette on downstream nodes automatically shows every HTTP variable reachable via the graph.</p>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="http-node" title="The HTTP Request node in depth">
                <p>Modeled after n8n&apos;s HTTP node — clean toggles for each section:</p>
                <ul>
                    <li><strong>Method</strong>: GET/POST/PUT/PATCH/DELETE/HEAD.</li>
                    <li><strong>URL</strong>: variable-aware (embed <Code>{`{{...}}`}</Code>).</li>
                    <li><strong>Send Query Parameters</strong>: toggle-on shows a key/value list appended to the URL as <Code>?a=b&amp;c=d</Code>.</li>
                    <li><strong>Send Headers</strong>: toggle-on shows a key/value list. Legacy newline strings are still parsed.</li>
                    <li><strong>Send Body</strong>: toggle-on lets you pick a body type — JSON, Raw text, or Form URL-encoded.</li>
                </ul>
                <DocsSubSection id="http-json" title="JSON body editor">
                    <p>When body type is JSON:</p>
                    <ul>
                        <li>Line-number gutter.</li>
                        <li>Live JSON validation — red border + inline error when the body is malformed, green &ldquo;Valid JSON&rdquo; when clean.</li>
                        <li><strong>Format</strong> button — pretty-prints and preserves any <Code>{`{{variables}}`}</Code> you&apos;ve inserted.</li>
                        <li><Code>Content-Type: application/json</Code> is added automatically when body is JSON.</li>
                    </ul>
                </DocsSubSection>
                <Callout kind="tip">
                    <p>Failure semantics: on timeout / non-2xx / network error, the run still continues. The variable holds <Code>null</Code>, and two extras appear alongside: <Code>{`{{apiResponse}}_status`}</Code> (HTTP status code) and <Code>{`{{apiResponse}}_error`}</Code> (error message). Use them in a <strong>Condition</strong> node to branch on failure.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="quick-branch" title="Branching on quick-reply buttons">
                <p>
                    Instagram DM quick replies and WhatsApp polls both support <em>per-option branching</em>. Every button/option
                    on the node gets its own output handle on the right side; wire each to a different downstream node and the
                    flow continues from the branch the customer picked.
                </p>

                <DocsSubSection id="qb-how" title="How it works">
                    <Step n={1} title="Add options">
                        <p>On the DM/Poll node, add quick replies (IG) or poll options (WA). Each option becomes a violet handle on the right edge of the node.</p>
                    </Step>
                    <Step n={2} title="Wire branches">
                        <p>Drag from each handle to whatever action should run when that option is picked. Options with no wire simply do nothing when tapped.</p>
                    </Step>
                    <Step n={3} title="Save + let it fire">
                        <p>Save the automation. When the trigger fires, alChatBot sends the DM/poll and <em>parks</em> the flow. As soon as the customer replies with a matching option label (or votes), the flow resumes down the corresponding branch. Wait states expire after 1 hour if no reply comes.</p>
                    </Step>
                </DocsSubSection>

                <ExampleBox title="Example — post-comment menu">
                    <CodeBlock lang="flow">{`[IG · Post] (keyword: "+")
        ↓
[IG · Send DM]
   text:        "Hi {{username}}! What would you like to know?"
   buttons:     ["Menu", "Order Status", "Contact Support"]
        ↓                   ↓                    ↓
   [Menu branch]      [Order branch]     [Support branch]
   Send catalog PDF   HTTP: fetch status  Ping operator
`}</CodeBlock>
                </ExampleBox>
            </DocsSection>

            <DocsSection id="ai-reply" title="Handing off to an AI agent">
                <p>The <strong>AI Agent Reply</strong> node picks a specific agent and lets it answer the current trigger — overriding whatever agent the channel is normally bound to.</p>
                <p>Common uses:</p>
                <ul>
                    <li>An <em>ad-specific agent</em>: automation triggers on ad-click referrer → AI Agent Reply routes to a bespoke sales agent.</li>
                    <li>A <em>comment-answering agent</em>: IG Post trigger → AI Agent Reply routes to an agent tuned for public replies, delivered via the comment→DM route.</li>
                </ul>
                <Callout kind="info">
                    <p>The agent&apos;s answer is delivered through the normal channel — WhatsApp DM, Instagram DM, or comment-to-DM depending on where the trigger fired.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="conditions" title="Conditions">
                <p>Branch the flow on a check. A Condition node has two output handles — <em>true</em> (green) and <em>false</em> (red).</p>
                <ul>
                    <li><strong>field</strong>: <Code>message</Code> / <Code>tag</Code> / <Code>status</Code>.</li>
                    <li><strong>operator</strong>: <Code>contains</Code> / <Code>equals</Code> / <Code>not_equals</Code>.</li>
                    <li><strong>value</strong>: what to compare against.</li>
                </ul>
                <Callout kind="tip">
                    <p>Use a Condition after an HTTP node to branch on the status: <Code>{`{{apiResponse}}_status`}</Code> equals <Code>200</Code> → success flow; otherwise → error flow.</p>
                </Callout>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
