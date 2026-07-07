import Link from "next/link";
import { Fragment } from "react";
import { Check, X as XIcon, ArrowRight, Sparkles } from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export const metadata = {
    title: "Pricing — alChatBot",
    description: "Simple, volume-based pricing. Every plan includes every channel — WhatsApp, Instagram, Facebook Ads, Google Calendar.",
};

const TIERS = [
    {
        name: "Starter",
        priceMonthly: 0,
        priceYearly: 0,
        blurb: "Everything you need to test the platform on one channel.",
        cta: "Start free",
        featured: false,
        features: [
            "1 messaging channel",
            "1 AI agent",
            "500 AI messages / month",
            "Basic analytics (30-day retention)",
            "Community support",
        ],
        excluded: [
            "Automations",
            "Router agents",
            "Google Calendar connector",
            "Data tables",
        ],
    },
    {
        name: "Business",
        priceMonthly: 49,
        priceYearly: 39, // per month billed yearly
        blurb: "Everything a growing team needs to answer at scale.",
        cta: "Start 7-day trial",
        featured: true,
        features: [
            "Up to 3 messaging channels",
            "Unlimited AI agents",
            "10 000 AI messages / month",
            "Automations + connectors",
            "Router agents",
            "Google Calendar + HTTP tools",
            "Data tables + memory tools",
            "Analytics (12-month retention)",
            "Priority email support",
        ],
        excluded: [
            "SSO / SAML",
            "Custom AI providers",
        ],
    },
    {
        name: "Scale",
        priceMonthly: null,
        priceYearly: null,
        blurb: "For teams closing high-ticket deals over messaging.",
        cta: "Talk to sales",
        featured: false,
        features: [
            "Unlimited channels",
            "Unlimited AI messages (fair use)",
            "SSO / SAML & audit log",
            "Custom AI providers + BYO keys",
            "Uptime SLA + dedicated success manager",
            "Bulk campaigns + broadcasting",
            "On-prem deployment option",
            "Custom contract & billing",
        ],
        excluded: [],
    },
];

const COMPARE_ROWS: { section: string; rows: { label: string; values: (string | boolean)[] }[] }[] = [
    {
        section: "Channels",
        rows: [
            { label: "WhatsApp Business", values: [true, true, true] },
            { label: "Instagram DMs + comments", values: [true, true, true] },
            { label: "Facebook Ads (click-to-message)", values: [true, true, true] },
            { label: "Channel count", values: ["1", "3", "Unlimited"] },
        ],
    },
    {
        section: "AI agents",
        rows: [
            { label: "Number of agents", values: ["1", "Unlimited", "Unlimited"] },
            { label: "Included AI messages / month", values: ["500", "10 000", "Unlimited*"] },
            { label: "GPT, Claude, Gemini, GLM support", values: [true, true, true] },
            { label: "Router agents", values: [false, true, true] },
            { label: "Bring your own API keys", values: [false, false, true] },
        ],
    },
    {
        section: "Automation",
        rows: [
            { label: "Visual automation editor", values: [false, true, true] },
            { label: "HTTP request node", values: [false, true, true] },
            { label: "WhatsApp polls + branching", values: [false, true, true] },
            { label: "Google Calendar bookings", values: [false, true, true] },
        ],
    },
    {
        section: "Team",
        rows: [
            { label: "Workspace members", values: ["1", "10", "Unlimited"] },
            { label: "Roles & permissions", values: [false, true, true] },
            { label: "SSO / SAML", values: [false, false, true] },
            { label: "Audit log", values: [false, false, true] },
        ],
    },
    {
        section: "Support",
        rows: [
            { label: "Community + docs", values: [true, true, true] },
            { label: "Priority email support", values: [false, true, true] },
            { label: "Uptime SLA", values: [false, false, true] },
            { label: "Dedicated success manager", values: [false, false, true] },
        ],
    },
];

const FAQ = [
    {
        q: "Is there a free trial?",
        a: "Yes. Every paid plan starts with a 7-day full-feature trial. No credit card required to start; add one before the trial ends to keep the workspace active.",
    },
    {
        q: "What counts as an AI message?",
        a: "One AI-generated reply that we send to your customer. Incoming messages, poll votes, and inbound webhooks are free. Automation actions that don't call the AI (send a static text, tag a contact, HTTP request) don't count.",
    },
    {
        q: "Can I bring my own OpenAI / Anthropic API keys?",
        a: "On the Business plan you can plug in your own keys per provider — usage bills your account directly with Anthropic/OpenAI/Google. On Starter you use ours. Scale plan supports bring-your-own-keys plus custom providers.",
    },
    {
        q: "What happens if I hit my message limit?",
        a: "We notify you at 80% and again at 100%. Above the limit you can either upgrade or top up in packs of 5 000 messages. Automations still fire; only AI-generated replies pause until top-up.",
    },
    {
        q: "Do you support WhatsApp Business API?",
        a: "Yes — via the underlying Baileys library today (no Meta approval needed, works with any WA Business number). Official Cloud API support is on the roadmap for high-volume Scale customers.",
    },
    {
        q: "Where is my data stored?",
        a: "EU-based PostgreSQL by default. Scale customers can request US or on-prem deployment.",
    },
];

export default function PricingPage() {
    return (
        <MarketingShell>
            <section className="max-w-7xl mx-auto px-6 pt-20 pb-10 text-center">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary mb-5">
                    <Sparkles className="w-3.5 h-3.5" /> Pricing
                </span>
                <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
                    Volume-based pricing, <span className="bg-gradient-to-r from-primary to-orange-400 bg-clip-text text-transparent">no per-seat trap</span>.
                </h1>
                <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
                    Every plan includes every channel. Invite as many teammates as you need; you pay for AI message volume, not chairs at a table.
                </p>
            </section>

            {/* Tiers */}
            <section className="max-w-7xl mx-auto px-6 pb-16">
                <div className="grid gap-5 lg:grid-cols-3">
                    {TIERS.map(t => (
                        <div key={t.name}
                            className={`relative rounded-3xl border p-8 flex flex-col ${
                                t.featured
                                    ? 'border-primary/60 bg-gradient-to-b from-primary/10 to-transparent shadow-2xl shadow-primary/10'
                                    : 'border-border bg-card'
                            }`}>
                            {t.featured && (
                                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-semibold px-3 py-1 rounded-full bg-primary text-primary-foreground uppercase tracking-widest">
                                    Most popular
                                </span>
                            )}
                            <div>
                                <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">{t.name}</div>
                                <div className="mt-4 flex items-baseline gap-1.5">
                                    {t.priceMonthly === null ? (
                                        <span className="text-4xl font-bold">Custom</span>
                                    ) : t.priceMonthly === 0 ? (
                                        <span className="text-4xl font-bold">Free</span>
                                    ) : (
                                        <>
                                            <span className="text-5xl font-bold">${t.priceMonthly}</span>
                                            <span className="text-sm text-muted-foreground">/month</span>
                                        </>
                                    )}
                                </div>
                                {t.priceYearly !== null && t.priceYearly !== 0 && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                        or <span className="text-foreground/80 font-medium">${t.priceYearly}/mo</span> billed yearly
                                    </div>
                                )}
                                <p className="text-sm text-muted-foreground mt-4 leading-relaxed">{t.blurb}</p>
                            </div>

                            <Link href={t.name === "Scale" ? "mailto:murad.cafarzada212@gmail.com" : "/register"}
                                className={`mt-6 inline-flex items-center justify-center gap-2 text-sm font-semibold py-3 rounded-xl transition-all ${
                                    t.featured
                                        ? 'bg-gradient-to-r from-primary to-amber-500 text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-95'
                                        : 'border border-border hover:bg-secondary/40'
                                }`}>
                                {t.cta} <ArrowRight className="w-4 h-4" />
                            </Link>

                            <ul className="mt-7 space-y-2.5 text-sm flex-1">
                                {t.features.map(f => (
                                    <li key={f} className="flex items-start gap-2">
                                        <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" /> <span>{f}</span>
                                    </li>
                                ))}
                                {t.excluded.map(f => (
                                    <li key={f} className="flex items-start gap-2 text-muted-foreground/70">
                                        <XIcon className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{f}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            {/* Comparison table */}
            <section className="max-w-7xl mx-auto px-6 py-14">
                <div className="text-center mb-10">
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Compare plans</h2>
                    <p className="mt-2 text-muted-foreground">The full feature matrix.</p>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-border bg-card">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="text-left px-6 py-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Feature</th>
                                {TIERS.map(t => (
                                    <th key={t.name} className={`text-center px-6 py-4 font-semibold text-xs uppercase tracking-wider ${t.featured ? 'text-primary' : ''}`}>
                                        {t.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {COMPARE_ROWS.map(sec => (
                                <Fragment key={sec.section}>
                                    <tr className="bg-secondary/30 border-t border-border">
                                        <td colSpan={4} className="px-6 py-2.5 text-xs font-semibold uppercase tracking-widest text-foreground/70">
                                            {sec.section}
                                        </td>
                                    </tr>
                                    {sec.rows.map(r => (
                                        <tr key={r.label} className="border-t border-border/40 hover:bg-secondary/20 transition-colors">
                                            <td className="px-6 py-3 text-sm">{r.label}</td>
                                            {r.values.map((v, i) => (
                                                <td key={i} className={`px-6 py-3 text-center ${TIERS[i].featured ? 'bg-primary/[0.03]' : ''}`}>
                                                    {typeof v === 'boolean'
                                                        ? (v ? <Check className="w-4 h-4 text-primary mx-auto" /> : <span className="text-muted-foreground/40">—</span>)
                                                        : <span className="text-sm">{v}</span>
                                                    }
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-[11px] text-muted-foreground mt-3 text-right">* Fair use: 500 000 messages / month soft cap on Scale, quotas negotiable.</p>
            </section>

            {/* FAQ */}
            <section className="max-w-3xl mx-auto px-6 py-20">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-10">Frequently asked</h2>
                <div className="space-y-3">
                    {FAQ.map(f => (
                        <details key={f.q} className="group rounded-2xl border border-border bg-card p-5 open:pb-6">
                            <summary className="flex items-center justify-between gap-4 cursor-pointer list-none">
                                <span className="font-medium">{f.q}</span>
                                <span className="text-muted-foreground group-open:rotate-45 transition-transform text-lg leading-none">+</span>
                            </summary>
                            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{f.a}</p>
                        </details>
                    ))}
                </div>
            </section>

            {/* CTA */}
            <section className="max-w-4xl mx-auto px-6 pb-24">
                <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-10 text-center">
                    <h2 className="text-2xl md:text-3xl font-bold">Still have a question?</h2>
                    <p className="text-muted-foreground mt-2">Email us — we usually reply within a business day.</p>
                    <a href="mailto:murad.cafarzada212@gmail.com"
                        className="inline-flex items-center gap-2 mt-5 text-sm font-semibold px-5 py-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                        Contact sales <ArrowRight className="w-4 h-4" />
                    </a>
                </div>
            </section>
        </MarketingShell>
    );
}
