import Link from "next/link";
import { DocsPageHeader, DocsSection, DocsSubSection, Callout, Code, Step } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "Inbox & CRM — alChatBot Docs" };

export default function InboxPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Inbox & CRM"
                title="One shared inbox for the whole team"
                blurb="Every DM, comment, and ad reply from every connected channel lands in one place. Custom fields, tags, and statuses live inline with the conversation. Human teammates can jump in whenever they want." />

            <DocsSection id="inbox" title="Shared inbox">
                <p>Open <Code>/dashboard/inbox</Code>. You&apos;ll see three tabs and a left-side conversation list.</p>

                <DocsSubSection id="tabs" title="Tabs">
                    <ul>
                        <li><strong>WhatsApp</strong> — every WA conversation across every connected number.</li>
                        <li><strong>Instagram</strong> — every IG DM across every connected account.</li>
                        <li><strong>Comments</strong> — Instagram comments that haven&apos;t been auto-handled by an automation. Reply, mark ignored, or hide.</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="conversation" title="Conversation view">
                    <p>Click a conversation to open it. You&apos;ll see:</p>
                    <ul>
                        <li>The message thread — text, media (images, video, audio players, docs), polls with live tallies.</li>
                        <li>Delivery ticks (sent / delivered / read) mirrored from the platform.</li>
                        <li>The customer&apos;s CRM panel on the right — name, phone, status, tags, custom fields, ad referrer.</li>
                        <li>The current agent and its status (Active / Paused).</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="reply" title="Replying as a human">
                    <p>Type a reply in the composer at the bottom. Sending your own reply doesn&apos;t pause the agent — for a proper handoff, use the <strong>Pause agent</strong> button on the CRM panel. Unpause when you&apos;re done.</p>
                    <Callout kind="tip" title="Talk to agent panel">
                        <p>Every conversation has a &ldquo;Talk to agent&rdquo; panel — an operator-only back-channel where you can ask the agent questions about the customer (&ldquo;What did they say last week?&rdquo;) without the customer seeing anything.</p>
                    </Callout>
                </DocsSubSection>

                <DocsSubSection id="realtime" title="Realtime updates">
                    <p>Inbox is live: new messages, delivery ticks, poll votes, and comment replies push to the open chat via WebSockets. No refresh needed.</p>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="crm" title="Contacts (CRM)">
                <p>Open <Code>/dashboard/contacts</Code> for the full contact list.</p>

                <DocsSubSection id="crm-list" title="List view">
                    <ul>
                        <li>Every unique sender across every channel gets one row.</li>
                        <li>Instagram contacts show <Code>@username</Code> and profile picture; WhatsApp contacts show phone number + pushName.</li>
                        <li>Filter by channel, tag, status, or custom field.</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="crm-status" title="Status">
                    <p>A short label describing where the contact is in your funnel. Defaults to <Code>NEW</Code>; the agent updates it via <Code>upsertClient</Code>, or you can change it manually. Customise the allowed labels from the workspace settings.</p>
                </DocsSubSection>

                <DocsSubSection id="crm-tags" title="Tags">
                    <p>Free-form labels — <Code>VIP</Code>, <Code>Baku</Code>, <Code>website-inquiry</Code>. Agents add them via <Code>addTag</Code> or the <strong>Add Tag</strong> automation action. Use them as filters in analytics and campaign targeting.</p>
                </DocsSubSection>

                <DocsSubSection id="custom-fields" title="Custom fields">
                    <p>Go to <Code>/dashboard/contacts</Code> → <strong>Manage Fields</strong>. Define your own attributes:</p>
                    <ul>
                        <li><strong>Key</strong> — snake_case identifier the agent will read/write (<Code>age</Code>, <Code>company_size</Code>).</li>
                        <li><strong>Label</strong> — human-readable name shown in the UI.</li>
                        <li><strong>Type</strong> — text, number, date, or select.</li>
                    </ul>
                    <p>Enable the <Link className="underline" href="/docs/skills#user-fields">User Fields skill</Link> on an agent to let it save answers into these fields.</p>
                </DocsSubSection>

                <DocsSubSection id="pause-resume" title="Pausing contacts">
                    <p>A paused contact stops receiving auto-replies. Their messages still land in the inbox — the agent just doesn&apos;t answer. Two ways to pause:</p>
                    <ul>
                        <li>Manual — click <strong>Pause agent</strong> on the CRM panel.</li>
                        <li>Automatic — the agent uses the <Link className="underline" href="/docs/skills#self-pause">Self-pause skill</Link> when it decides handoff is appropriate.</li>
                    </ul>
                    <p>Resume from the same panel to hand the conversation back to the AI.</p>
                </DocsSubSection>
            </DocsSection>

            <DocsSection id="ad-attribution" title="Ad attribution">
                <p>Contacts who arrived through a click-to-message ad show the ad&apos;s campaign, ad set, and ad ID in the CRM panel. Combined with tags and analytics, you can trace revenue back to specific campaigns.</p>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
