import Link from "next/link";
import { Bot, MessageSquare, Github, Twitter, Linkedin } from "lucide-react";

/**
 * Public marketing shell — header + footer wrapper reused by the
 * landing, features, pricing, privacy and terms pages. Kept as a plain
 * component (no `layout.tsx`) so we don't fight route groups on this
 * Next.js version; every marketing page just imports and wraps its
 * body with it.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <MarketingHeader />
            <main className="flex-1">{children}</main>
            <MarketingFooter />
        </div>
    );
}

function MarketingHeader() {
    return (
        <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-lg">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary via-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-shadow">
                        <Bot className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
                    </div>
                    <span className="font-bold text-lg tracking-tight">alChatBot</span>
                </Link>

                <nav className="hidden md:flex items-center gap-8 text-sm">
                    <Link href="/features" className="text-muted-foreground hover:text-foreground transition-colors">Features</Link>
                    <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
                    <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
                    <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
                </nav>

                <div className="flex items-center gap-2">
                    <Link href="/login"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">
                        Sign in
                    </Link>
                    <Link href="/register"
                        className="text-sm font-medium px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-amber-500 text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/20">
                        Get started
                    </Link>
                </div>
            </div>
        </header>
    );
}

function MarketingFooter() {
    return (
        <footer className="border-t border-border/50 mt-24">
            <div className="max-w-7xl mx-auto px-6 py-14 grid gap-10 md:grid-cols-4">
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary via-amber-400 to-orange-500 flex items-center justify-center">
                            <Bot className="w-4 h-4 text-primary-foreground" strokeWidth={2.5} />
                        </div>
                        <span className="font-bold">alChatBot</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
                        AI-powered messaging for WhatsApp, Instagram, and Meta Ads. Handle every conversation without hiring another rep.
                    </p>
                    <div className="flex items-center gap-3 mt-4 text-muted-foreground">
                        <a href="https://twitter.com" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
                            <Twitter className="w-4 h-4" />
                        </a>
                        <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
                            <Linkedin className="w-4 h-4" />
                        </a>
                        <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
                            <Github className="w-4 h-4" />
                        </a>
                    </div>
                </div>

                <FooterCol title="Product" links={[
                    { label: "Features", href: "/features" },
                    { label: "Pricing", href: "/pricing" },
                    { label: "Log in", href: "/login" },
                    { label: "Sign up", href: "/register" },
                ]} />

                <FooterCol title="Company" links={[
                    { label: "Contact", href: "mailto:murad.cafarzada212@gmail.com" },
                    { label: "Status", href: "/" },
                ]} />

                <FooterCol title="Legal" links={[
                    { label: "Privacy Policy", href: "/privacy" },
                    { label: "Terms of Service", href: "/terms" },
                ]} />
            </div>
            <div className="border-t border-border/50">
                <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>© {new Date().getFullYear()} alChatBot. All rights reserved.</span>
                    <span className="flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3" /> Built for teams that reply on WhatsApp, Instagram, and beyond.
                    </span>
                </div>
            </div>
        </footer>
    );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
    return (
        <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70 mb-3">{title}</h4>
            <ul className="space-y-2">
                {links.map(l => (
                    <li key={l.href + l.label}>
                        <Link href={l.href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                            {l.label}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
