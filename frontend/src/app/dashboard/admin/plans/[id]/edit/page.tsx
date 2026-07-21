"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import api from "@/lib/api";
import { PlanEditor, type Plan } from "../../_components/PlanEditor";

export default function EditPlanPage() {
    const params = useParams<{ id: string }>();
    const id = params?.id;
    const [plan, setPlan] = useState<Plan | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;
        (async () => {
            try {
                // No single-plan endpoint yet — pluck from the admin list.
                const res = await api.get('/plans');
                if (res.data.success) {
                    const found = res.data.plans.find((p: any) => p.id === id);
                    if (found) setPlan(found);
                    else setError('Plan not found');
                } else {
                    setError(res.data.message || 'Failed to load plan');
                }
            } catch (err: any) {
                setError(err.response?.data?.message || err.message);
            }
        })();
    }, [id]);

    if (error) return (
        <div className="max-w-2xl mx-auto bg-red-500/5 border border-red-500/25 rounded-2xl p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
                <div className="font-medium text-red-400">Couldn't load plan</div>
                <div className="text-xs text-muted-foreground mt-1">{error}</div>
            </div>
        </div>
    );
    if (!plan) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return <PlanEditor initial={plan} />;
}
