import Link from "next/link";
import {
    Bot, MessageSquare, Camera, Workflow, GitBranch, Users, BarChart3,
    Calendar, Database, ShieldCheck, Zap, Sparkles, ArrowRight, Layers,
    Send, Globe, MessageCircle, Brain, Clock, Server, Mic,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export const metadata = {
    title: "Features — alChatBot",
    description: "Deep dive into every feature: AI agents, visual automations, channel integrations, connectors, and analytics.",
};

const SECTIONS = [
    {
        icon: Bot,
        eyebrow: "AI Agents",
        title: "Every agent, exactly the shape you need",
        blurb: "Pick a model, wire up tools, tune the memory. Test in a sandbox before shipping.",
        tint: "from-amber-500/20 via-transparent to-transparent",
        bullets: [
            { icon: Brain, title: "Multi-provider", desc: "OpenAI (GPT-5, o-series), Anthropic Claude Opus/Sonnet, Google Gemini 2.5, Z.ai GLM 4.6 — swap providers per agent without rebuilding prompts." },
            { icon: Layers, title: "Skills as checkboxes", desc: "Toggle memory, CRM, user fields, HTTP tools, live-operator handoff, WhatsApp polls, Google Calendar. Each skill drops in its own tools + guidance." },
            { icon: Mic, title: "Voice notes → text", desc: "Whisper transcription runs on incoming audio DMs. Agent answers what the customer actually said, not a placeholder." },
            { icon: MessageCircle, title: "Vision on media", desc: "Send an agent product photos, screenshots, or menu shots — vision-enabled models read them and reply in context." },
        ],
    },
    {
        icon: Workflow,
        eyebrow: "Automations",
        title: "Visual playbooks that actually branch",
        blurb: "Trigger. Filter. Fetch. Reply. Route. Build the whole customer journey on a live canvas.",
        tint: "from-violet-500/20 via-transparent to-transparent",
        bullets: [
            { icon: Zap, title: "Rich triggers", desc: "WhatsApp keyword, Instagram DM keyword, IG post/comment, click-to-message ad, new contact — each with keyword modes (contains, exact, starts, regex)." },
            { icon: GitBranch, title: "Per-button branches", desc: "Send a DM with quick-reply buttons or a WhatsApp poll — each option becomes its own output handle on the node. The flow resumes down whichever branch the customer tapped." },
            { icon: Server, title: "HTTP request node", desc: "Call any API mid-flow. Response goes into a variable you reference downstream as {{apiResponse.data.name}} — with JSON body editor, headers, query params." },
            { icon: MessageSquare, title: "AI-agent handoff", desc: "Insert an 'AI Agent Reply' node to swap the responding agent mid-flow. Great for routing 'sales' vs 'support' intents into specialised agents." },
        ],
    },
    {
        icon: Globe,
        eyebrow: "Channels",
        title: "One codebase. Every messaging surface.",
        blurb: "Same agent, same memory, same tools — no matter where the customer wrote you from.",
        tint: "from-emerald-500/20 via-transparent to-transparent",
        bullets: [
            { icon: MessageSquare, title: "WhatsApp Business", desc: "Multi-number, media handling, native polls with vote decryption, group chats, contact profiles + LID/PN mapping done right." },
            { icon: Camera, title: "Instagram DMs + comments", desc: "Auto-reply on comments, comment-to-DM bypass of the 24-hour window, quick-reply buttons, image + audio + document media." },
            { icon: Send, title: "Facebook Ads (click-to-message)", desc: "Route each ad to the agent trained for that campaign. Track lead → agent → outcome end-to-end in one thread." },
        ],
    },
    {
        icon: Users,
        eyebrow: "Inbox & CRM",
        title: "One shared inbox for the whole team",
        blurb: "Real-time updates, custom fields, tags, statuses — all inline with the conversation.",
        tint: "from-blue-500/20 via-transparent to-transparent",
        bullets: [
            { icon: MessageSquare, title: "Realtime updates", desc: "Socket.IO events push new messages, delivery ticks, poll votes, and comment replies to the open chat without a refresh." },
            { icon: Users, title: "Custom fields", desc: "Define fields (age, city, plan, purpose…) on the Contacts page. Agents read + write them via a first-class tool; humans see them in the CRM panel." },
            { icon: Sparkles, title: "AI-assisted CRM", desc: "Agents auto-upsert clients on first contact, tag by intent, and update the status as conversations progress. Sales team gets pre-qualified rows." },
        ],
    },
    {
        icon: Calendar,
        eyebrow: "Connectors",
        title: "Bring your workspace with you",
        blurb: "Third-party services your agents can use as tools. Connect once per workspace.",
        tint: "from-cyan-500/20 via-transparent to-transparent",
        bullets: [
            { icon: Calendar, title: "Google Calendar", desc: "Agent checks availability with listCalendarEvents, books slots with createCalendarEvent, cancels with cancelCalendarEvent. Google-native invites to attendees." },
            { icon: Server, title: "Custom HTTP tools", desc: "Give an agent a Bitrix, Notion, or in-house API tool via reusable HTTP templates — parameter schemas, headers, dynamic values from the conversation." },
            { icon: Database, title: "Data tables", desc: "Upload price lists, FAQs, product catalogues as tables. Agents search across turns and answer with the right row inline." },
        ],
    },
    {
        icon: BarChart3,
        eyebrow: "Analytics",
        title: "The metrics that pay rent",
        blurb: "Response time, resolution rate, ad ROI, agent quality — filtered every way you'd want.",
        tint: "from-pink-500/20 via-transparent to-transparent",
        bullets: [
            { icon: Clock, title: "Response time", desc: "Median and p95 first-reply time, broken down by channel, agent, and time-of-day. See where the night shift needs help." },
            { icon: Brain, title: "Agent quality", desc: "Oversight agents review a sample of every agent's replies and flag issues you'd have missed. Learn from your own conversations." },
            { icon: BarChart3, title: "Ad attribution", desc: "See which Meta Ad campaign brought each lead, what the agent said, and whether it converted. Close the reporting loop." },
        ],
    },
    {
        icon: ShieldCheck,
        eyebrow: "Team + Security",
        title: "Built for real businesses",
        blurb: "Workspaces, roles, audit trails, and data handling designed for teams that aren't playing.",
        tint: "from-red-500/20 via-transparent to-transparent",
        bullets: [
            { icon: Users, title: "Workspaces + roles", desc: "Invite teammates, assign owner-defined roles with granular permissions (inbox view/write, agent edit, CRM access…). Every mutation gates through the role matrix." },
            { icon: ShieldCheck, title: "Live-operator escalation", desc: "Agent doesn't know the answer? It pings a real human over WhatsApp, waits for the reply, and forwards it to the customer — with full audit trail." },
            { icon: Server, title: "Your data, your keys", desc: "Bring your own AI API keys on higher plans — usage bills your Anthropic/OpenAI account directly. On-prem deployment available for Scale customers." },
        ],
    },
];

export default function FeaturesPage() {
    return (
        <MarketingShell>
            <section className="max-w-7xl mx-auto px-6 pt-20 pb-14 text-center">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary mb-5">
                    <Sparkles className="w-3.5 h-3.5" /> Features
                </span>
                <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-4xl mx-auto">
                    Everything you need,{" "}
                    <span className="bg-gradient-to-r from-primary to-orange-400 bg-clip-text text-transparent">nothing you don&apos;t</span>.
                </h1>
                <p className="mt-5 text-muted-foreground max-w-2xl mx-auto">
                    alChatBot is opinionated where it should be (channels, agents, playbooks) and endlessly configurable where you need it (skills, tools, roles).
                </p>
            </section>

            {SECTIONS.map((s, i) => (
                <section key={s.eyebrow} className="max-w-7xl mx-auto px-6 py-14">
                    <div className={`relative rounded-3xl border border-border bg-card p-8 md:p-12 overflow-hidden ${i % 2 === 0 ? '' : ''}`}>
                        <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${s.tint} -z-10`} />

                        <div className="max-w-2xl">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary font-semibold">
                                <s.icon className="w-4 h-4" /> {s.eyebrow}
                            </div>
                            <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">{s.title}</h2>
                            <p className="mt-3 text-muted-foreground">{s.blurb}</p>
                        </div>

                        <div className="mt-8 grid gap-4 md:grid-cols-2">
                            {s.bullets.map(b => (
                                <div key={b.title} className="flex gap-3 rounded-2xl border border-border/60 bg-background/40 p-4">
                                    <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                                        <b.icon className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-sm">{b.title}</h3>
                                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{b.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            ))}

            {/* Final CTA */}
            <section className="max-w-4xl mx-auto px-6 pb-24">
                <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-10 text-center">
                    <h2 className="text-2xl md:text-4xl font-bold tracking-tight">See it in your workspace.</h2>
                    <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
                        Try every feature free for 7 days. Connect a channel, build an agent, ship a flow — all before your credit card runs out (there isn&apos;t one).
                    </p>
                    <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                        <Link href="/register"
                            className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-amber-500 text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-95 transition-opacity">
                            Start free trial <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link href="/pricing"
                            className="inline-flex items-center gap-2 text-sm font-medium px-5 py-3 rounded-xl border border-border hover:bg-secondary/40 transition-colors">
                            See pricing
                        </Link>
                    </div>
                </div>
            </section>
        </MarketingShell>
    );
}
