import Link from "next/link";
import { Rocket, Plug, Bot, Wrench, Workflow, Blocks, Inbox as InboxIcon, Sparkles, ArrowRight } from "lucide-react";
import { DocsPageHeader, DocsSection, Callout, Code } from "@/components/docs/DocsComponents";
import { DocsPrevNext } from "@/components/docs/DocsNav";

export const metadata = {
    title: "Documentation — alChatBot",
    description: "Everything you need to know to run alChatBot end-to-end: connect channels, build agents, ship automations.",
};

const CARDS = [
    { href: "/docs/quickstart",  icon: Rocket,     title: "Quickstart",   desc: "Sign up, connect a channel, ship your first AI reply in ten minutes." },
    { href: "/docs/channels",    icon: Plug,       title: "Channels",     desc: "Connect WhatsApp Business, Instagram, and Meta/Facebook Ads to your workspace." },
    { href: "/docs/agents",      icon: Bot,        title: "AI Agents",    desc: "Pick a model, write a system prompt, tune memory + timezone, test in the sandbox." },
    { href: "/docs/skills",      icon: Wrench,     title: "Agent Skills", desc: "Every checkbox on the Skills panel explained, with example prompts." },
    { href: "/docs/automations", icon: Workflow,   title: "Automations",  desc: "Visual playbooks: triggers, actions, HTTP calls, and per-button branching." },
    { href: "/docs/connectors",  icon: Blocks,     title: "Connectors",   desc: "Workspace-level integrations. Currently: Google Calendar." },
    { href: "/docs/inbox",       icon: InboxIcon,  title: "Inbox & CRM",  desc: "Shared inbox across every channel, contacts, custom fields, and comments." },
    { href: "/docs/advanced",    icon: Sparkles,   title: "Advanced",     desc: "Router agents, oversight, API keys, webhooks, MCP, custom AI providers." },
];

export default function DocsIndexPage() {
    return (
        <>
            <DocsPageHeader
                eyebrow="Documentation"
                title="Learn alChatBot end-to-end"
                blurb="alChatBot connects WhatsApp, Instagram, and Meta Ads to configurable AI agents and visual automations. These docs walk you through every feature — from connecting your first channel to writing router logic and calling external APIs from a conversation." />

            <DocsSection id="what-is" title="What is alChatBot?">
                <p>
                    alChatBot is a hosted platform that turns your messaging channels into one shared workspace and lets AI agents
                    do the heavy lifting. Instead of hiring a night-shift rep, you configure an agent — pick a model, write a system
                    prompt, toggle a handful of skills — and route customer messages through it.
                </p>
                <p>
                    Everything you configure lives at the workspace level. Invite teammates, split responsibilities via roles, and
                    keep every conversation in one shared inbox. Channels, agents, automations, contacts, and analytics all belong
                    to the workspace — not to individual users.
                </p>

                <Callout kind="info" title="Where to start">
                    <p>
                        New here? Follow the <Link className="underline" href="/docs/quickstart">Quickstart</Link>. It walks
                        through registering, adding an AI provider key, creating a first agent, connecting a channel, and testing
                        the whole flow in about ten minutes.
                    </p>
                </Callout>
            </DocsSection>

            <DocsSection id="who" title="Who is this for?">
                <p>
                    alChatBot fits any business that answers customers over WhatsApp or Instagram at scale. Concrete examples:
                </p>
                <ul>
                    <li>
                        <strong>Retail shops</strong> — automate FAQs, share the catalogue via a Data Table, and hand hot leads to the sales team.
                    </li>
                    <li>
                        <strong>Service businesses</strong> (clinics, gyms, tutors) — let the agent check availability on Google Calendar and book consultations automatically.
                    </li>
                    <li>
                        <strong>Agencies</strong> — run separate workspaces per client, each with its own agents, channels, and reporting.
                    </li>
                    <li>
                        <strong>E-commerce</strong> — pair click-to-message ads with routing agents that qualify leads and drop them into your CRM.
                    </li>
                </ul>
            </DocsSection>

            <DocsSection id="reading-order" title="Recommended reading order">
                <p>
                    Docs are split by topic so you can jump to what you need. If you&apos;re reading in order, this is the natural path:
                </p>
                <div className="grid gap-3 md:grid-cols-2 mt-4 not-doc-prose">
                    {CARDS.map((c, i) => (
                        <Link key={c.href} href={c.href}
                            className="group rounded-2xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-card/80 transition-colors">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                                    <c.icon className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Chapter {i + 1}</div>
                                    <div className="font-semibold text-base">{c.title}</div>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
                            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary group-hover:gap-2 transition-all">
                                Read chapter <ArrowRight className="w-3 h-3" />
                            </div>
                        </Link>
                    ))}
                </div>
            </DocsSection>

            <DocsSection id="conventions" title="Conventions used in these docs">
                <ul>
                    <li>
                        <Code>Inline code</Code> is used for placeholder names, tool identifiers, environment variables, and short values.
                    </li>
                    <li>
                        Multi-line code blocks show shell commands, JSON payloads, or full example prompts.
                    </li>
                    <li>
                        Callouts appear when something matters: <strong>Info</strong> for background context, <strong>Tip</strong> for
                        productivity shortcuts, <strong>Warning</strong> for pitfalls, <strong>Success</strong> for confirmations.
                    </li>
                    <li>
                        Every page ends with a <em>Previous / Next</em> block so you can move linearly if you like.
                    </li>
                </ul>
            </DocsSection>

            <Callout kind="tip" title="Need something not covered?">
                <p>
                    Email <a className="underline" href="mailto:murad.cafarzada212@gmail.com">murad.cafarzada212@gmail.com</a> —
                    responses usually come within a business day, and we&apos;ll add missing topics to this documentation.
                </p>
            </Callout>

            <DocsPrevNext />
        </>
    );
}
