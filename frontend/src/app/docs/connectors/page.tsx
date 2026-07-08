import Link from "next/link";
import { DocsPageHeader, DocsSection, DocsSubSection, Callout, Code, Step, ExampleBox, Bubble } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "Connectors — alChatBot Docs" };

export default function ConnectorsPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Connectors"
                title="Workspace-level integrations"
                blurb="Connectors are third-party services your AI agents can use as tools. Unlike agent-scoped skills, a connector is authorised once per workspace and every agent with the matching skill toggled on gets access." />

            <DocsSection id="concept" title="Concept">
                <p>
                    A skill like <Code>google_calendar</Code> adds tools to an agent — but those tools need something to talk to.
                    A <strong>connector</strong> is the authorised link between the workspace and the external service (in this case,
                    a specific Google account&apos;s Calendar).
                </p>
                <p>
                    Workspace-level was a deliberate choice: you connect once, and every agent in the workspace can use it.
                    Perfect for teams — the owner does the OAuth dance, everyone else just toggles the skill on their agents.
                </p>
                <Callout kind="info">
                    <p>Only workspace owners can add or remove connectors. Members can see the connection status, but can&apos;t change it.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="google-calendar" title="Google Calendar">
                <p>Currently the only connector shipped. Lets agents check availability and book meetings on the workspace&apos;s selected calendar.</p>

                <DocsSubSection id="gc-connect" title="Connecting">
                    <Step n={1} title="Open Connectors">
                        <p>Navigate to <Code>/dashboard/connectors</Code>. You&apos;ll see the Google Calendar card at the top.</p>
                    </Step>
                    <Step n={2} title="Click Connect">
                        <p>You&apos;re redirected to Google&apos;s consent screen. Sign in with the Google account whose calendar you want to expose to your agents. Grant the requested scopes:</p>
                        <ul>
                            <li><Code>calendar.events</Code> — create, update, and cancel events.</li>
                            <li><Code>calendar.readonly</Code> — list calendars and read events for availability checks.</li>
                        </ul>
                    </Step>
                    <Step n={3} title="Pick a calendar">
                        <p>By default the connection uses your <Code>primary</Code> calendar. Click the calendar chip on the Connectors card to switch — the picker lists every calendar you have write access to.</p>
                    </Step>
                </DocsSubSection>

                <DocsSubSection id="gc-enable" title="Enabling on an agent">
                    <Step n={1} title="Open the agent">
                        <p>Go to <Code>/dashboard/ai/agents</Code> → open the agent → scroll to <strong>Skills</strong>.</p>
                    </Step>
                    <Step n={2} title="Toggle Google Calendar">
                        <p>Tick the checkbox next to Google Calendar (recognisable by the branded logo + <strong>CONNECTOR</strong> badge). The expanded panel shows the connection status — green if the workspace is already connected, amber with a Connect CTA if not.</p>
                    </Step>
                    <Step n={3} title="Set the agent&apos;s timezone">
                        <p>Above the System Prompt, pick the correct timezone (e.g. <Code>Asia/Baku</Code>). This drives the ISO offsets in every calendar tool call.</p>
                    </Step>
                    <Step n={4} title="Save + test">
                        <p>Save the agent and open the Sandbox. Ask something like &ldquo;Do you have any openings tomorrow between 2 and 6 PM?&rdquo; — you should see the agent call <Code>listCalendarEvents</Code> and respond with a real availability answer.</p>
                    </Step>
                </DocsSubSection>

                <DocsSubSection id="gc-example" title="What this looks like end-to-end">
                    <ExampleBox title="Booking a consultation">
                        <Bubble side="in">Salam! Sabah 15:00-a bir konsultasiya bron edə bilərəm?</Bubble>
                        <p className="text-xs text-muted-foreground italic">Agent → listCalendarEvents(timeMin: tomorrow 14:00, timeMax: tomorrow 16:00) → free slot found.</p>
                        <Bubble side="out">Bəli, sabah saat 15:00 boşdur. Adınızı və e-poçtunuzu göndərin ki, sizin üçün Calendar-a əlavə edim.</Bubble>
                        <Bubble side="in">Aygün Rəhimova, aygun@example.com</Bubble>
                        <p className="text-xs text-muted-foreground italic">Agent → createCalendarEvent(summary: &quot;Konsultasiya — Aygün Rəhimova&quot;, start: 2026-07-09T15:00:00+04:00, end: 2026-07-09T15:30:00+04:00, attendees: [&quot;aygun@example.com&quot;]).</p>
                        <Bubble side="out">✓ Bron edildi — sabah saat 15:00–15:30. Google Calendar dəvətnaməsi e-poçtunuza gələcək. Görüşənədək!</Bubble>
                    </ExampleBox>
                    <p>The event lands on the connected calendar; the customer receives a Google Calendar invite by email with an RSVP button.</p>
                </DocsSubSection>

                <DocsSubSection id="gc-disconnect" title="Disconnecting">
                    <p>Click <strong>Disconnect</strong> on the Connectors card. This does two things:</p>
                    <ol>
                        <li>Revokes the refresh token via <Code>oauth2.googleapis.com/revoke</Code>.</li>
                        <li>Deletes the local connection row from the workspace.</li>
                    </ol>
                    <p>Any agent with <Code>google_calendar</Code> enabled will get an error the next time it tries to use a calendar tool. The skill itself stays enabled — reconnect the workspace and it starts working again immediately.</p>
                </DocsSubSection>

                <Callout kind="warning" title="Verification status">
                    <p>Google flags calendar scopes as &ldquo;sensitive&rdquo; and requires app verification before removing the &ldquo;unverified app&rdquo; consent-screen warning. Until verification completes, new users clicking Connect will see an <em>Advanced → Continue</em> screen — the flow still works, it&apos;s just less clean.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="roadmap" title="Coming soon">
                <p>Every connector uses the same pattern (workspace OAuth + per-skill tools). On the roadmap:</p>
                <ul>
                    <li>Notion — read/write pages from an agent.</li>
                    <li>Bitrix / HubSpot / Pipedrive — first-class CRM connectors.</li>
                    <li>Stripe — payment link generation from a conversation.</li>
                </ul>
                <p>Missing something you need? <a className="underline" href="mailto:murad.cafarzada212@gmail.com">Email us</a> — connector priority is driven by real customer requests.</p>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
