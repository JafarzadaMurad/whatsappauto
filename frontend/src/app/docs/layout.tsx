import { MarketingShell } from "@/components/marketing/MarketingShell";
import { DocsNav } from "@/components/docs/DocsNav";

/**
 * Shared layout for every /docs/* page. Wraps content with the public
 * marketing header + footer and drops a sticky left navigation for the
 * documentation section beside the article body.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
    return (
        <MarketingShell>
            <div className="max-w-7xl mx-auto px-6 py-10 md:py-14">
                <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
                    <aside className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
                        <DocsNav />
                    </aside>
                    <article className="min-w-0 max-w-3xl">
                        {children}
                    </article>
                </div>
            </div>
        </MarketingShell>
    );
}
