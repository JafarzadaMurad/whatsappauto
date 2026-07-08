import { Info, AlertTriangle, CheckCircle2, Lightbulb } from "lucide-react";

/**
 * Coloured callout for tips, warnings, notes and success messages
 * inside doc pages. Wraps arbitrary children so callouts can hold
 * inline code, lists, or short paragraphs.
 */
export function Callout({
    kind = "info",
    title,
    children,
}: {
    kind?: "info" | "tip" | "warning" | "success";
    title?: string;
    children: React.ReactNode;
}) {
    const styles = {
        info:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    text: 'text-blue-300',    icon: Info },
        tip:     { bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  text: 'text-violet-300',  icon: Lightbulb },
        warning: { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-300',   icon: AlertTriangle },
        success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', icon: CheckCircle2 },
    }[kind];
    const Icon = styles.icon;
    return (
        <div className={`my-6 rounded-xl border ${styles.border} ${styles.bg} p-4`}>
            <div className={`flex items-start gap-2 ${styles.text}`}>
                <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    {title && <div className="font-semibold text-sm mb-1">{title}</div>}
                    <div className="text-sm text-foreground/85 leading-relaxed [&>p]:my-2 first:[&>p]:mt-0 last:[&>p]:mb-0">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Numbered step block. Use inside an <ol className="doc-steps"> or just plain series. */
export function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
    return (
        <div className="flex gap-4 my-5">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/15 border border-primary/40 text-primary flex items-center justify-center text-sm font-semibold">
                {n}
            </div>
            <div className="flex-1 min-w-0 pt-1">
                <h4 className="font-semibold text-base">{title}</h4>
                {children && <div className="mt-2 text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>}
            </div>
        </div>
    );
}

/** Inline code style used everywhere for placeholders, keys, tool names. */
export function Code({ children }: { children: React.ReactNode }) {
    return (
        <code className="font-mono text-[0.86em] bg-secondary/60 border border-border rounded px-1.5 py-0.5 text-foreground/90">
            {children}
        </code>
    );
}

/** Multi-line code block (bash, JSON, prompt example). */
export function CodeBlock({ children, lang }: { children: string; lang?: string }) {
    return (
        <div className="my-5 rounded-xl overflow-hidden border border-border bg-secondary/30">
            {lang && (
                <div className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                    {lang}
                </div>
            )}
            <pre className="px-4 py-3 text-xs font-mono leading-relaxed overflow-x-auto text-foreground/90">
{children}
            </pre>
        </div>
    );
}

/** Example prompt / conversation transcript. */
export function ExampleBox({ title, children }: { title?: string; children: React.ReactNode }) {
    return (
        <div className="my-6 rounded-2xl border border-border bg-card overflow-hidden">
            {title && (
                <div className="px-5 py-3 border-b border-border bg-secondary/40 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {title}
                </div>
            )}
            <div className="p-5 text-sm leading-relaxed space-y-3 [&_p]:my-0">
                {children}
            </div>
        </div>
    );
}

/** Chat bubble used inside ExampleBox for conversation samples. */
export function Bubble({ side = "in", label, children }: { side?: "in" | "out"; label?: string; children: React.ReactNode }) {
    return (
        <div className={`flex ${side === 'out' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                side === 'out'
                    ? 'bg-emerald-500/15 border border-emerald-500/30 rounded-tr-md'
                    : 'bg-secondary/70 border border-border rounded-tl-md'
            }`}>
                {label && <div className="text-[10px] uppercase tracking-widest opacity-70 mb-1">{label}</div>}
                {children}
            </div>
        </div>
    );
}

/** Page header used at the top of every doc page. */
export function DocsPageHeader({ eyebrow, title, blurb }: { eyebrow?: string; title: string; blurb: string }) {
    return (
        <header className="mb-10 pb-6 border-b border-border">
            {eyebrow && (
                <div className="text-xs uppercase tracking-widest text-primary font-semibold mb-2">
                    {eyebrow}
                </div>
            )}
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
            <p className="mt-3 text-base text-muted-foreground max-w-3xl leading-relaxed">{blurb}</p>
        </header>
    );
}

/** Section anchor with visible link icon. Renders as h2 with an id. */
export function DocsSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
        <section id={id} className="scroll-mt-24 mt-12 first:mt-0">
            <h2 className="text-2xl font-bold tracking-tight mb-4 flex items-center gap-2 group">
                <a href={`#${id}`} className="opacity-0 group-hover:opacity-40 text-primary transition-opacity">#</a>
                {title}
            </h2>
            <div className="doc-prose">{children}</div>
        </section>
    );
}

/** Sub-section (h3). */
export function DocsSubSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
        <div id={id} className="scroll-mt-24 mt-8">
            <h3 className="text-xl font-semibold tracking-tight mb-3">{title}</h3>
            <div className="doc-prose">{children}</div>
        </div>
    );
}
