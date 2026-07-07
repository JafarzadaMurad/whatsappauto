import Link from "next/link";
import {
    ArrowRight, Bot, MessageSquare, Camera, Workflow, Sparkles, Zap,
    Users, BarChart3, Calendar, Globe, Check, Star, ShieldCheck,
    Clock, Database, GitBranch, Send,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export const metadata = {
    title: "alChatBot — AI messaging for WhatsApp, Instagram and Meta Ads",
    description:
        "Connect every messaging channel to configurable AI agents. Automate replies, qualify leads, book meetings, and run playbooks that convert — without hiring another rep.",
};

export default function HomePage() {
    return (
        <MarketingShell>
            <Hero />
            <TrustBar />
            <Features />
            <Channels />
            <HowItWorks />
            <Automation />
            <PricingPreview />
            <TestimonialStat />
            <FinalCTA />
        </MarketingShell>
    );
}

/* ─── Hero ─────────────────────────────────────────────────────── */
function Hero() {
    return (
        <section className="relative overflow-hidden">
            {/* Gradient orbs — subtle depth. Kept inside a `pointer-events-none`
                wrapper so they never eat clicks on real content. */}
            <div className="pointer-events-none absolute inset-0 -z-10">
                <div className="absolute top-[-20%] left-[10%] w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px]" />
                <div className="absolute top-[10%] right-[-10%] w-[500px] h-[500px] bg-fuchsia-500/10 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-20%] left-[30%] w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[100px]" />
            </div>

            <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 md:pt-32 md:pb-32">
                <div className="max-w-4xl mx-auto text-center">
                    <span className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary mb-6">
                        <Sparkles className="w-3.5 h-3.5" /> AI messaging for real businesses
                    </span>

                    <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.05]">
                        Reply to every customer,{" "}
                        <span className="bg-gradient-to-r from-primary via-amber-400 to-orange-500 bg-clip-text text-transparent">
                            in seconds
                        </span>
                        , around the clock.
                    </h1>

                    <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                        alChatBot connects your WhatsApp Business number, Instagram DMs and Facebook Ads to configurable AI agents.
                        Automate qualifying, book meetings on Google Calendar, and run visual playbooks that close deals — without hiring another rep.
                    </p>

                    <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
                        <Link href="/register"
                            className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-amber-500 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:opacity-95 transition-all">
                            Start free trial <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link href="/pricing"
                            className="inline-flex items-center gap-2 text-sm font-medium px-5 py-3 rounded-xl border border-border hover:bg-secondary/40 transition-colors">
                            View pricing
                        </Link>
                    </div>

                    <p className="mt-4 text-xs text-muted-foreground">
                        No credit card required · Cancel anytime · Set up in under 10 minutes
                    </p>
                </div>

                {/* Product mockup — abstracted as a card cluster so we don't
                    have to ship real screenshots yet. Communicates depth
                    without lying about the UI. */}
                <div className="mt-16 md:mt-24 max-w-5xl mx-auto">
                    <div className="relative rounded-3xl border border-border bg-gradient-to-b from-card via-card to-background p-4 shadow-2xl shadow-black/50">
                        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
                            {/* Fake sidebar */}
                            <div className="hidden md:block rounded-2xl bg-background/60 border border-border/60 p-3 space-y-1">
                                {[
                                    { icon: MessageSquare, name: "Inbox", badge: 12 },
                                    { icon: Bot, name: "AI Agents" },
                                    { icon: Workflow, name: "Automations" },
                                    { icon: Users, name: "Contacts" },
                                    { icon: BarChart3, name: "Analytics" },
                                    { icon: Calendar, name: "Connectors" },
                                ].map((it, i) => (
                                    <div key={it.name}
                                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${i === 0 ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}>
                                        <it.icon className="w-3.5 h-3.5" />
                                        <span className="flex-1">{it.name}</span>
                                        {it.badge && <span className="text-[9px] font-semibold bg-primary text-primary-foreground rounded px-1">{it.badge}</span>}
                                    </div>
                                ))}
                            </div>

                            {/* Fake chat */}
                            <div className="rounded-2xl bg-background/60 border border-border/60 p-4 min-h-[320px] flex flex-col gap-3">
                                <div className="flex items-center gap-2 pb-3 border-b border-border/40">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-semibold">A</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium">Aygün Rəhimova</div>
                                        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                            <MessageSquare className="w-2.5 h-2.5" /> WhatsApp · online
                                        </div>
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">Answered · 3s</span>
                                </div>

                                <BubbleIn text="Salam, sabah saat 15:00 üçün konsultasiya bron edə bilərəm?" />
                                <BubbleOut text="Əlbəttə! Zoom ilə görüşə bilərik. Adınızı və e-poçtunuzu təsdiq edin, sizin üçün Calendar-a qeyd edim." />
                                <BubbleIn text="Aygün Rəhimova, aygun@example.com" />
                                <BubbleOut text="✓ Bron edildi — Sabah 15:00-15:30. Zoom linki e-poçtunuzda. Görüşənədək!" agent />
                                <div className="mt-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3 text-primary" /> Auto-reply via Sales Agent</span>
                                    <span>·</span>
                                    <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3 text-blue-400" /> Booked via Google Calendar</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function BubbleIn({ text }: { text: string }) {
    return (
        <div className="max-w-[75%] self-start rounded-2xl rounded-tl-md bg-secondary/60 border border-border/40 px-3 py-2 text-xs leading-relaxed">
            {text}
        </div>
    );
}
function BubbleOut({ text, agent }: { text: string; agent?: boolean }) {
    return (
        <div className={`max-w-[75%] self-end rounded-2xl rounded-tr-md px-3 py-2 text-xs leading-relaxed ${agent ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-100' : 'bg-primary/15 border border-primary/30 text-primary-foreground/90'}`}>
            {text}
        </div>
    );
}

/* ─── Trust bar ─────────────────────────────────────────────────── */
function TrustBar() {
    return (
        <section className="border-y border-border/40 bg-card/30">
            <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4">
                <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Powered by</span>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
                    <span className="font-semibold">OpenAI</span>
                    <span className="font-semibold">Anthropic Claude</span>
                    <span className="font-semibold">Google Gemini</span>
                    <span className="font-semibold">Z.ai · GLM</span>
                    <span className="font-semibold">Meta Business</span>
                    <span className="font-semibold">Google Calendar</span>
                </div>
            </div>
        </section>
    );
}

/* ─── Features grid ─────────────────────────────────────────────── */
function Features() {
    const items = [
        { icon: Bot, title: "Configurable AI agents", desc: "Pick model, tone, memory depth. Give each agent tools — CRM, HTTP APIs, calendars — with a checkbox.", tint: "text-amber-300 bg-amber-500/10" },
        { icon: Workflow, title: "Visual automations", desc: "Drag-and-drop flows: keyword triggers, quick-reply buttons, HTTP calls, agent hand-offs. Test on real chats.", tint: "text-violet-300 bg-violet-500/10" },
        { icon: GitBranch, title: "Router agents", desc: "One entry point, many specialists. Auto-route each conversation to the agent trained for that intent.", tint: "text-blue-300 bg-blue-500/10" },
        { icon: Users, title: "Shared inbox + CRM", desc: "Every DM, comment, and ad reply in one thread. Custom fields, tags, statuses — inline.", tint: "text-emerald-300 bg-emerald-500/10" },
        { icon: Calendar, title: "Google Calendar bookings", desc: "Agents check availability and book slots on your team's shared calendar with one tool call.", tint: "text-cyan-300 bg-cyan-500/10" },
        { icon: BarChart3, title: "Analytics you'll actually read", desc: "Response times, resolution rate, agent quality, ad ROI — filtered by channel, agent, or campaign.", tint: "text-pink-300 bg-pink-500/10" },
        { icon: Database, title: "Data tables + memory", desc: "Feed price lists, FAQs, or product catalogues. Agents search across turns and answer with the right row.", tint: "text-orange-300 bg-orange-500/10" },
        { icon: ShieldCheck, title: "Live-operator handoff", desc: "Agent stuck? It pings a human teammate over WhatsApp, waits for their answer, and forwards it back.", tint: "text-red-300 bg-red-500/10" },
    ];
    return (
        <section id="features" className="max-w-7xl mx-auto px-6 py-24 md:py-32">
            <div className="max-w-2xl mb-14">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
                    Everything you need to answer <span className="bg-gradient-to-r from-primary to-orange-400 bg-clip-text text-transparent">at scale</span>.
                </h2>
                <p className="mt-4 text-muted-foreground">
                    Configurable enough to fit a real business. Simple enough to launch in an afternoon.
                </p>
            </div>
            <div className="grid gap-3 md:gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {items.map(it => (
                    <div key={it.title}
                        className="group rounded-2xl border border-border/60 bg-card p-5 hover:border-primary/40 hover:bg-card/80 transition-colors">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${it.tint}`}>
                            <it.icon className="w-5 h-5" />
                        </div>
                        <h3 className="font-semibold text-sm">{it.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{it.desc}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

/* ─── Channels showcase ─────────────────────────────────────────── */
function Channels() {
    const chans = [
        { icon: MessageSquare, name: "WhatsApp Business", desc: "Multi-number, media, polls, contact profiles, group chats.", tint: "from-emerald-500/20 to-emerald-500/5 text-emerald-300 border-emerald-500/30" },
        { icon: Camera, name: "Instagram DMs & Comments", desc: "Auto-reply on comments, quick-reply buttons, comment-to-DM route.", tint: "from-pink-500/20 to-pink-500/5 text-pink-300 border-pink-500/30" },
        { icon: Globe, name: "Facebook Ads", desc: "Route each click-to-message ad to the right agent. Track conversion end-to-end.", tint: "from-blue-500/20 to-blue-500/5 text-blue-300 border-blue-500/30" },
    ];
    return (
        <section className="max-w-7xl mx-auto px-6 py-16">
            <div className="text-center max-w-2xl mx-auto mb-12">
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">One inbox. Every channel.</h2>
                <p className="mt-3 text-muted-foreground">Same agent, same tools, same memory — no matter where the customer wrote you from.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
                {chans.map(c => (
                    <div key={c.name}
                        className={`rounded-2xl border bg-gradient-to-br ${c.tint} p-6 backdrop-blur-sm`}>
                        <c.icon className="w-8 h-8 mb-3" />
                        <h3 className="font-semibold">{c.name}</h3>
                        <p className="text-xs opacity-90 mt-1.5 leading-relaxed">{c.desc}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

/* ─── How it works ─────────────────────────────────────────────── */
function HowItWorks() {
    const steps = [
        {
            n: 1,
            title: "Connect your channels",
            body: "Scan a QR to link your WhatsApp Business number. Log in with Meta Business to authorise Instagram + Facebook Ads. Optional: connect Google Calendar.",
            icon: MessageSquare,
        },
        {
            n: 2,
            title: "Build your agent",
            body: "Pick a model (GPT-5, Claude Opus, Gemini or GLM), write a system prompt, toggle skills — CRM, HTTP tools, polls, calendar, live-operator handoff — and test in a sandbox.",
            icon: Bot,
        },
        {
            n: 3,
            title: "Ship, monitor, iterate",
            body: "Point one channel at the agent, watch conversations in the shared inbox, review analytics, and adjust flows as you learn what actually converts.",
            icon: BarChart3,
        },
    ];
    return (
        <section className="max-w-7xl mx-auto px-6 py-24">
            <div className="text-center max-w-2xl mx-auto mb-14">
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">From signup to first automated reply in{" "}
                    <span className="text-primary">10 minutes</span>.
                </h2>
            </div>
            <div className="grid gap-6 md:grid-cols-3 relative">
                <div className="hidden md:block absolute top-8 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-border to-transparent -z-10" />
                {steps.map(s => (
                    <div key={s.n} className="text-center">
                        <div className="w-16 h-16 rounded-2xl bg-card border border-border mx-auto mb-4 flex items-center justify-center relative">
                            <s.icon className="w-7 h-7 text-primary" />
                            <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">{s.n}</span>
                        </div>
                        <h3 className="font-semibold text-lg">{s.title}</h3>
                        <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-xs mx-auto">{s.body}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

/* ─── Automation callout ─────────────────────────────────────────── */
function Automation() {
    return (
        <section className="max-w-7xl mx-auto px-6 py-24">
            <div className="grid md:grid-cols-2 gap-10 items-center">
                <div>
                    <span className="text-xs uppercase tracking-widest text-primary font-semibold">Automations</span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mt-2">
                        Visual playbooks that <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">actually branch</span>.
                    </h2>
                    <p className="mt-4 text-muted-foreground leading-relaxed">
                        Chain triggers, filters, HTTP calls, quick-reply buttons and agent hand-offs on a live canvas.
                        Each button on your reply becomes its own output — the flow continues down whichever branch the customer picked.
                    </p>
                    <ul className="mt-6 space-y-3 text-sm">
                        {[
                            "Trigger on IG comment, WA keyword, new contact, or ad click",
                            "Call any HTTP API and reuse the JSON downstream",
                            "Poll customers with WhatsApp-native polls — each option is its own branch",
                            "Hand-off to a specific AI agent mid-flow",
                        ].map(x => (
                            <li key={x} className="flex items-start gap-2">
                                <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                                <span>{x}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Node graph illustration */}
                <div className="relative rounded-3xl border border-border bg-card p-6 min-h-[380px] overflow-hidden">
                    <div className="absolute inset-0 opacity-30 pointer-events-none">
                        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(240 3.7% 22%)" strokeWidth="0.5" />
                                </pattern>
                            </defs>
                            <rect width="100%" height="100%" fill="url(#grid)" />
                        </svg>
                    </div>
                    <div className="relative space-y-3">
                        <FlowCard icon={Camera} tint="border-pink-500/40 bg-pink-500/5 text-pink-300" title="Instagram · Post" sub={'1 post · "+"'} />
                        <div className="w-px h-4 bg-border ml-6" />
                        <FlowCard icon={Send} tint="border-pink-500/40 bg-pink-500/5 text-pink-300" title="Instagram · Send DM" sub="Salam {name}!" branches={["Sual 1", "Sual 2", "Sual 3"]} />
                    </div>
                </div>
            </div>
        </section>
    );
}

function FlowCard({ icon: Icon, tint, title, sub, branches }: any) {
    return (
        <div className={`rounded-xl border-2 ${tint} bg-card overflow-hidden`}>
            <div className="flex items-center gap-2 px-3 py-2 bg-black/30">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-semibold">{title}</span>
            </div>
            <div className="px-3 py-2 text-[11px] text-muted-foreground">{sub}</div>
            {branches && (
                <div className="border-t border-border/40">
                    {branches.map((b: string) => (
                        <div key={b} className="px-3 py-1.5 text-[11px] border-t border-border/30 first:border-t-0 flex items-center justify-between">
                            <span>▸ {b}</span>
                            <span className="w-2 h-2 rounded-full bg-violet-500" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─── Pricing preview ─────────────────────────────────────────── */
function PricingPreview() {
    return (
        <section className="max-w-7xl mx-auto px-6 py-24">
            <div className="text-center mb-14">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Simple pricing. No per-seat lock-in.</h2>
                <p className="mt-3 text-muted-foreground max-w-xl mx-auto">Every plan includes every channel. Pay for message volume, not for user chairs.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3 max-w-5xl mx-auto">
                <PriceCard tier="Starter" price="Free" note="7-day trial" features={["1 channel", "1 AI agent", "500 messages/mo", "Basic analytics"]} />
                <PriceCard tier="Business" price="$49" per="/mo" featured features={["3 channels", "Unlimited agents", "10 000 messages/mo", "Automations + connectors", "Priority support"]} />
                <PriceCard tier="Scale" price="Custom" features={["Unlimited channels", "Custom AI providers", "SLA & SSO", "Dedicated success", "On-prem option"]} />
            </div>
            <div className="text-center mt-8">
                <Link href="/pricing" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                    Compare all plans <ArrowRight className="w-4 h-4" />
                </Link>
            </div>
        </section>
    );
}

function PriceCard({ tier, price, per, note, features, featured }: any) {
    return (
        <div className={`rounded-2xl border p-6 flex flex-col ${featured ? 'border-primary/50 bg-gradient-to-b from-primary/10 to-transparent relative shadow-lg shadow-primary/10' : 'border-border bg-card'}`}>
            {featured && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground uppercase tracking-widest">
                    Most popular
                </span>
            )}
            <div className="mb-3">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">{tier}</div>
                <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{price}</span>
                    {per && <span className="text-sm text-muted-foreground">{per}</span>}
                </div>
                {note && <div className="text-xs text-muted-foreground mt-1">{note}</div>}
            </div>
            <ul className="space-y-2 text-sm flex-1">
                {features.map((f: string) => (
                    <li key={f} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" /> <span>{f}</span>
                    </li>
                ))}
            </ul>
            <Link href="/register"
                className={`mt-6 inline-flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-lg transition-colors ${featured ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-border hover:bg-secondary/40'}`}>
                Get started
            </Link>
        </div>
    );
}

/* ─── Social proof block ─────────────────────────────────────────── */
function TestimonialStat() {
    return (
        <section className="max-w-7xl mx-auto px-6 py-24">
            <div className="grid gap-8 md:grid-cols-2 items-center">
                <div className="rounded-3xl border border-border bg-card p-8">
                    <div className="flex gap-0.5 mb-4 text-primary">
                        {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                    </div>
                    <p className="text-lg leading-relaxed">
                        &ldquo;We replaced two customer-support hires with one agent on alChatBot. Response time dropped from 4 hours to 6 seconds, and the sales team gets qualified leads with the CRM row already filled in.&rdquo;
                    </p>
                    <div className="mt-5 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-semibold text-sm">L</div>
                        <div>
                            <div className="text-sm font-semibold">Leyla Aliyeva</div>
                            <div className="text-xs text-muted-foreground">Head of Growth · Retrip Travel</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <StatCard n="6s" label="avg. reply time" />
                    <StatCard n="94%" label="conversations resolved without a human" />
                    <StatCard n="12x" label="more leads qualified per rep" />
                    <StatCard n="24/7" label="coverage across all channels" />
                </div>
            </div>
        </section>
    );
}

function StatCard({ n, label }: { n: string; label: string }) {
    return (
        <div className="rounded-2xl border border-border bg-card p-5">
            <div className="text-3xl font-bold bg-gradient-to-r from-primary to-orange-400 bg-clip-text text-transparent">{n}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-tight">{label}</div>
        </div>
    );
}

/* ─── Final CTA ─────────────────────────────────────────────────── */
function FinalCTA() {
    return (
        <section className="max-w-5xl mx-auto px-6 py-16">
            <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 via-amber-500/5 to-orange-500/10 p-10 md:p-14 text-center">
                <div className="pointer-events-none absolute inset-0 -z-10">
                    <div className="absolute top-[-50%] left-[-10%] w-[400px] h-[400px] bg-primary/20 rounded-full blur-[120px]" />
                    <div className="absolute bottom-[-50%] right-[-10%] w-[400px] h-[400px] bg-fuchsia-500/20 rounded-full blur-[120px]" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-primary/20 text-primary border border-primary/40 mb-5">
                    <Clock className="w-3 h-3" /> 10-minute setup
                </span>
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight">Every customer deserves an answer.</h2>
                <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
                    Start a free trial. Wire up your first channel. Let an AI agent take the night shift.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
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
    );
}
