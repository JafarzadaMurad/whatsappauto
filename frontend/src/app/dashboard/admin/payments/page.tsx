"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Save, ExternalLink } from "lucide-react";
import api from "@/lib/api";

const STRIPE_KEYS = [
    { key: 'STRIPE_SECRET_KEY', label: 'Stripe Secret Key', placeholder: 'sk_live_... or sk_test_...', isSecret: true,
        hint: 'Found in Stripe Dashboard → Developers → API keys. Use test key first.' },
    { key: 'STRIPE_PUBLISHABLE_KEY', label: 'Stripe Publishable Key', placeholder: 'pk_live_... or pk_test_...', isSecret: false,
        hint: 'Same page in Stripe — Publishable key. Used by the frontend.' },
    { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe Webhook Signing Secret', placeholder: 'whsec_...', isSecret: true,
        hint: 'Create a webhook endpoint in Stripe → Developers → Webhooks → Add endpoint. Use https://<your-domain>/api/billing/webhook. Subscribe to subscription + invoice events. Copy the signing secret here.' },
];

const ALL_KEYS = STRIPE_KEYS;

export default function AdminPaymentsPage() {
    const [values, setValues] = useState<Record<string, string>>({});
    const [updatedAt, setUpdatedAt] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const load = async () => {
        try {
            const res = await api.get('/admin/config');
            if (res.data.success) {
                const cfg = res.data.config;
                const v: Record<string, string> = {};
                const u: Record<string, string> = {};
                for (const k of ALL_KEYS) {
                    v[k.key] = cfg[k.key]?.value || '';
                    u[k.key] = cfg[k.key]?.updatedAt || '';
                }
                setValues(v);
                setUpdatedAt(u);
            }
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        setSaving(true);
        setSaved(false);
        try {
            // Only send fields the admin actually filled in
            const entries: Record<string, string> = {};
            for (const k of ALL_KEYS) {
                if (values[k.key] && values[k.key].trim()) entries[k.key] = values[k.key].trim();
            }
            await api.put('/admin/config', { entries });
            setSaved(true);
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><CreditCard className="w-6 h-6" /></div>
                    Payment Integration
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Configure Stripe so users can subscribe to plans.</p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                {STRIPE_KEYS.map(k => (
                    <div key={k.key}>
                        <label className="text-sm font-medium">{k.label}</label>
                        <input
                            type={k.isSecret ? 'password' : 'text'}
                            value={values[k.key] || ''}
                            onChange={e => setValues({ ...values, [k.key]: e.target.value })}
                            placeholder={k.placeholder}
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        <p className="text-xs text-muted-foreground mt-1">{k.hint}</p>
                        {updatedAt[k.key] && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">last updated: {new Date(updatedAt[k.key]).toLocaleString()}</p>
                        )}
                    </div>
                ))}

                <div className="flex items-center justify-between pt-2">
                    {saved && <span className="text-xs text-emerald-400">Saved.</span>}
                    <div className="flex-1" />
                    <button onClick={save} disabled={saving}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save keys
                    </button>
                </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-3 text-sm">
                <h2 className="font-semibold">Stripe setup checklist</h2>
                <ol className="space-y-2 text-muted-foreground list-decimal pl-5">
                    <li>Create a Stripe account if you don't have one (<a className="text-primary hover:underline" href="https://dashboard.stripe.com/register" target="_blank" rel="noreferrer">dashboard.stripe.com <ExternalLink className="w-3 h-3 inline" /></a>).</li>
                    <li>In Stripe Dashboard → <span className="text-foreground">Developers → API keys</span>, copy the <span className="text-foreground">Secret key</span> and <span className="text-foreground">Publishable key</span>. Start with test mode.</li>
                    <li>For each Plan in <span className="text-foreground">Admin → Plans</span>, create a matching <span className="text-foreground">Product</span> and <span className="text-foreground">Price</span> in Stripe (Catalog → Products). Copy the Price ID (<code className="bg-secondary px-1 rounded">price_...</code>) into the plan's <span className="text-foreground">Stripe Price ID</span> field.</li>
                    <li>Go to <span className="text-foreground">Developers → Webhooks → Add endpoint</span>. Endpoint URL: <code className="bg-secondary px-1 rounded">https://chatbot.tur.al/api/billing/webhook</code>. Subscribe to events: <code className="bg-secondary px-1 rounded">customer.subscription.created</code>, <code className="bg-secondary px-1 rounded">customer.subscription.updated</code>, <code className="bg-secondary px-1 rounded">customer.subscription.deleted</code>, <code className="bg-secondary px-1 rounded">invoice.paid</code>, <code className="bg-secondary px-1 rounded">invoice.payment_failed</code>.</li>
                    <li>Copy the webhook's <span className="text-foreground">Signing secret</span> (<code className="bg-secondary px-1 rounded">whsec_...</code>) into the field above.</li>
                    <li>Save. The next phase will wire actual Stripe Checkout into the user Billing page.</li>
                </ol>
            </div>
        </div>
    );
}
