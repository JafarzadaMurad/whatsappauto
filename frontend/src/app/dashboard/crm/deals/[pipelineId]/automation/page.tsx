"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { AutomationEditor } from "@/app/dashboard/automations/[id]/page";

/**
 * Deal-scope automation editor. Wraps the shared AutomationEditor
 * component with a URL like /dashboard/crm/deals/<pipelineId>/automation
 * so the operator's mental model stays inside the pipeline. On mount
 * we hit the ensure-automation endpoint which creates the row on
 * first visit and returns the existing one afterwards.
 */
export default function DealAutomationPage({ params }: { params: Promise<{ pipelineId: string }> }) {
    const { pipelineId } = use(params);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [automationId, setAutomationId] = useState<string | null>(null);
    const [pipelineName, setPipelineName] = useState<string>("");

    useEffect(() => {
        (async () => {
            try {
                const [aRes, pRes] = await Promise.all([
                    api.get(`/crm/pipelines/${pipelineId}/automation`),
                    api.get('/crm/pipelines'),
                ]);
                if (aRes.data?.success) setAutomationId(aRes.data.automation.id);
                if (pRes.data?.success) {
                    const p = pRes.data.pipelines.find((x: any) => x.id === pipelineId);
                    if (p) setPipelineName(p.name);
                }
            } catch (e: any) {
                setError(e.response?.data?.message || e.message);
            } finally {
                setLoading(false);
            }
        })();
    }, [pipelineId]);

    if (loading) return (
        <div className="flex justify-center items-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    if (error || !automationId) return (
        <div className="max-w-xl mx-auto py-16 text-center space-y-4">
            <div className="text-sm text-red-400">{error || 'Could not load automation.'}</div>
            <Link href={`/dashboard/crm/deals/${pipelineId}`} className="text-primary hover:underline text-sm">← Back to pipeline</Link>
        </div>
    );

    return (
        <div>
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3 border-b border-border">
                <Link href={`/dashboard/crm/deals/${pipelineId}`}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="w-3.5 h-3.5" /> {pipelineName || 'Pipeline'}
                </Link>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">Deal automation</span>
            </div>
            <AutomationEditor id={automationId} />
        </div>
    );
}
