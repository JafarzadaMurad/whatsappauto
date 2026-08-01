"use client";

// Merged into Admin → AI Providers, where a provider's key, models and
// pricing sit together. Kept as a redirect so bookmarks and any links
// still land somewhere useful.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function MovedPage() {
    const router = useRouter();
    useEffect(() => { router.replace("/dashboard/admin/ai-providers"); }, [router]);
    return (
        <div className="flex flex-col items-center justify-center h-96 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Moved to AI Providers…</p>
        </div>
    );
}
