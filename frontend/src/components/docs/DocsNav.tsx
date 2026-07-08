"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    BookOpen, Rocket, Plug, Bot, Wrench, Workflow, Blocks,
    Inbox as InboxIcon, Sparkles,
} from "lucide-react";

export const DOCS_PAGES = [
    { href: "/docs",             label: "Introduction",  icon: BookOpen },
    { href: "/docs/quickstart",  label: "Quickstart",    icon: Rocket },
    { href: "/docs/channels",    label: "Channels",      icon: Plug },
    { href: "/docs/agents",      label: "AI Agents",     icon: Bot },
    { href: "/docs/skills",      label: "Agent Skills",  icon: Wrench },
    { href: "/docs/automations", label: "Automations",   icon: Workflow },
    { href: "/docs/connectors",  label: "Connectors",    icon: Blocks },
    { href: "/docs/inbox",       label: "Inbox & CRM",   icon: InboxIcon },
    { href: "/docs/advanced",    label: "Advanced",      icon: Sparkles },
] as const;

export function DocsNav() {
    const pathname = usePathname();
    return (
        <nav className="text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-3 font-semibold">
                Documentation
            </div>
            <ul className="space-y-0.5">
                {DOCS_PAGES.map(p => {
                    const active = pathname === p.href;
                    return (
                        <li key={p.href}>
                            <Link href={p.href}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                                    active
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                                }`}>
                                <p.icon className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{p.label}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}

/**
 * Prev / Next block rendered at the bottom of every doc page. Reads
 * the current URL from `usePathname` and finds the neighbours in the
 * DOCS_PAGES array.
 */
export function DocsPrevNext() {
    const pathname = usePathname();
    const idx = DOCS_PAGES.findIndex(p => p.href === pathname);
    if (idx === -1) return null;
    const prev = idx > 0 ? DOCS_PAGES[idx - 1] : null;
    const next = idx < DOCS_PAGES.length - 1 ? DOCS_PAGES[idx + 1] : null;
    return (
        <div className="grid gap-3 sm:grid-cols-2 mt-16 pt-8 border-t border-border">
            {prev ? (
                <Link href={prev.href} className="rounded-xl border border-border p-4 hover:bg-secondary/40 transition-colors">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">← Previous</div>
                    <div className="mt-1 font-medium">{prev.label}</div>
                </Link>
            ) : <div />}
            {next ? (
                <Link href={next.href} className="rounded-xl border border-border p-4 hover:bg-secondary/40 transition-colors text-right">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Next →</div>
                    <div className="mt-1 font-medium">{next.label}</div>
                </Link>
            ) : <div />}
        </div>
    );
}
