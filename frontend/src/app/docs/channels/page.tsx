import Link from "next/link";
import { DocsPageHeader, DocsSection, DocsSubSection, Callout, Code, Step } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = { title: "Channels — alChatBot Docs" };

export default function ChannelsPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Channels"
                title="Connect WhatsApp, Instagram, and Meta Ads"
                blurb="Every conversation the agent sees comes from a connected channel. This page walks through each channel type: prerequisites, connection flow, and what to expect once traffic starts flowing." />

            <DocsSection id="whatsapp" title="WhatsApp Business">
                <p>
                    alChatBot uses the underlying WhatsApp Web protocol via a battle-tested open-source library. That means
                    <strong> no Meta business verification is required</strong> — you just scan a QR code from your phone and start receiving
                    messages instantly.
                </p>

                <DocsSubSection id="wa-prereqs" title="Prerequisites">
                    <ul>
                        <li>A WhatsApp Business (or personal) account on a phone.</li>
                        <li>Phone with WhatsApp installed and internet access.</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="wa-connect" title="Connect a number">
                    <Step n={1} title="Open the WhatsApp page">
                        <p>Navigate to <Code>/dashboard/whatsapp</Code>. You&apos;ll see a list of any instances already connected.</p>
                    </Step>
                    <Step n={2} title="Add instance">
                        <p>Click <strong>Add instance</strong>, give it a name (e.g. &ldquo;Support&rdquo;, &ldquo;Sales &mdash; RU&rdquo;), and confirm.</p>
                    </Step>
                    <Step n={3} title="Scan the QR">
                        <p>A QR code appears in the browser. On your phone:</p>
                        <ol>
                            <li>Open <strong>WhatsApp</strong>.</li>
                            <li>Go to <strong>Settings → Linked Devices → Link a device</strong>.</li>
                            <li>Scan the QR on the alChatBot screen.</li>
                        </ol>
                        <p>The instance flips to <strong>Connected</strong> within 2–3 seconds. Your phone must stay online with WhatsApp installed — if you sign out on the phone, the browser session ends too.</p>
                    </Step>
                    <Step n={4} title="Bind an agent">
                        <p>On the instance card, pick <strong>Primary agent</strong>. Every incoming message on this number now routes through that agent. Optional: pick a <strong>Router agent</strong> to fan out to specialists (see <Link className="underline" href="/docs/advanced#router-agents">Router agents</Link>).</p>
                    </Step>
                </DocsSubSection>

                <DocsSubSection id="wa-multi" title="Multiple numbers">
                    <p>You can connect as many WhatsApp instances as your plan allows. Each has its own primary agent, router, and metrics — perfect for splitting Sales / Support or serving multiple brands from one workspace.</p>
                </DocsSubSection>

                <DocsSubSection id="wa-features" title="What works out of the box">
                    <ul>
                        <li><strong>Text messages</strong> both ways.</li>
                        <li><strong>Media</strong> — inbound images, videos, audio, documents; outbound sends via automations or agent tools.</li>
                        <li><strong>Voice notes</strong> — Whisper transcribes them automatically when the agent has <Code>audioEnabled</Code>.</li>
                        <li><strong>Polls</strong> — send native WhatsApp polls, receive votes (with tallies) in real time.</li>
                        <li><strong>Contact profiles</strong> — pushName + verifiedName + profile picture, cached and shown in the inbox.</li>
                        <li><strong>LID/PN mapping</strong> — WhatsApp&apos;s new opaque identifiers are transparently mapped back to phone numbers.</li>
                    </ul>
                </DocsSubSection>

                <Callout kind="warning" title="Keep the phone online">
                    <p>Because this uses the WhatsApp Web protocol, the primary phone must remain connected to the internet.
                    If it goes offline for more than a few hours, the linked session may drop and you&apos;ll need to rescan the QR.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="instagram" title="Instagram DMs and Comments">
                <p>Instagram integration uses Meta&apos;s official Graph API via the Instagram Business Login flow. Once connected, the agent replies to DMs, moderates comments, and can trigger automations on new posts.</p>

                <DocsSubSection id="ig-prereqs" title="Prerequisites">
                    <ul>
                        <li>An Instagram <strong>Business</strong> or <strong>Creator</strong> account (personal accounts don&apos;t work).</li>
                        <li>The account must be reachable via <em>Business Login for Instagram</em> — no separate Facebook Page pairing needed.</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="ig-connect" title="Connect an account">
                    <Step n={1} title="Open Instagram">
                        <p>Navigate to <Code>/dashboard/instagram</Code> → <strong>Connect account</strong>.</p>
                    </Step>
                    <Step n={2} title="Log in with Instagram">
                        <p>You&apos;re redirected to Instagram&apos;s consent screen. Log in with the Instagram Business account you want to link. Approve the requested permissions:</p>
                        <ul>
                            <li><Code>instagram_business_basic</Code> — read your account info.</li>
                            <li><Code>instagram_business_manage_messages</Code> — send / receive DMs.</li>
                            <li><Code>instagram_business_manage_comments</Code> — read comments and post replies.</li>
                        </ul>
                    </Step>
                    <Step n={3} title="Back to the dashboard">
                        <p>Meta redirects you back to the app. The account card now shows your username, profile picture, and follower count.</p>
                    </Step>
                    <Step n={4} title="Bind an agent">
                        <p>Same as WhatsApp: pick a <strong>Primary agent</strong>. The agent will handle every DM the account receives.</p>
                    </Step>
                </DocsSubSection>

                <DocsSubSection id="ig-features" title="What works out of the box">
                    <ul>
                        <li><strong>Direct Messages</strong> both ways.</li>
                        <li><strong>Media</strong> — inbound images, video, audio; outbound images, video, quick-reply buttons.</li>
                        <li><strong>Comments</strong> — inbound comments show up in a dedicated Comments tab in the inbox. Automations can auto-reply as a public comment <em>or</em> send a private DM to the commenter via the comment→DM route.</li>
                        <li><strong>Voice notes</strong> — transcribed via Whisper (same as WhatsApp).</li>
                        <li><strong>Vision</strong> — inbound images are forwarded to vision-capable models as native image parts.</li>
                    </ul>
                </DocsSubSection>

                <Callout kind="info" title="Agents skip Instagram comments by default">
                    <p>By product design, an agent bound to an Instagram account only answers <strong>DMs</strong>. Comments stay in the Comments tab and are handled by automations — build an <Code>IG · Post</Code> trigger to auto-reply or hide/delete. This keeps AI out of public-facing comment threads unless you explicitly opt in via automation.</p>
                </Callout>
            </DocsSection>

            <DocsSection id="ads" title="Facebook / Meta Ads">
                <p>
                    Click-to-message ads on Facebook and Instagram can route each click through alChatBot. When a user taps
                    &ldquo;Send message&rdquo; on your ad, the resulting conversation lands on the connected channel <strong>tagged with the ad&apos;s ID</strong>,
                    and you can bind a specific agent per ad or per campaign.
                </p>

                <DocsSubSection id="ads-connect" title="Connect Meta Ads">
                    <Step n={1} title="Open Facebook Ads">
                        <p>Go to <Code>/dashboard/meta</Code> → <strong>Connect Meta Business</strong>.</p>
                    </Step>
                    <Step n={2} title="Log in via Facebook Login for Business">
                        <p>Grant read access to your Ad Accounts. alChatBot never posts or edits ads — it only reads their metadata for attribution and reporting.</p>
                    </Step>
                    <Step n={3} title="Pick an ad account">
                        <p>If you manage multiple Ad Accounts, choose the one you want to connect. You can add more later.</p>
                    </Step>
                </DocsSubSection>

                <DocsSubSection id="ads-routing" title="Per-ad agent routing">
                    <p>On the Ads page you&apos;ll see every click-to-message ad in the connected account. For each one, you can:</p>
                    <ul>
                        <li>Bind a specific <strong>AI agent</strong> — leads that come through this ad are handled by this agent, overriding the channel default.</li>
                        <li>Add a per-ad <strong>system prompt suffix</strong> — e.g. &ldquo;This lead is a Black-Friday visitor, mention our 30% discount code.&rdquo;</li>
                    </ul>
                </DocsSubSection>

                <DocsSubSection id="ads-insights" title="Insights">
                    <p>Each connected ad shows spend, impressions, clicks, and the count of conversations attributed to it. Combined with the analytics page, you can measure &ldquo;how many booked meetings per $100 spent&rdquo; without spreadsheets.</p>
                </DocsSubSection>
            </DocsSection>

            <DocsPrevNext />
        </>
    );
}
