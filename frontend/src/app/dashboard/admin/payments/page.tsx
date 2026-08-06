"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Save, ExternalLink } from "lucide-react";
import api from "@/lib/api";
import UnsavedChangesBar from "@/components/UnsavedChangesBar";

const STRIPE_KEYS = [
    { key: 'STRIPE_SECRET_KEY', label: 'Stripe Secret Key', placeholder: 'sk_live_... or sk_test_...', isSecret: true,
        hint: 'Found in Stripe Dashboard → Developers → API keys. Use test key first.' },
    { key: 'STRIPE_PUBLISHABLE_KEY', label: 'Stripe Publishable Key', placeholder: 'pk_live_... or pk_test_...', isSecret: false,
        hint: 'Same page in Stripe — Publishable key. Used by the frontend.' },
    { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe Webhook Signing Secret', placeholder: 'whsec_...', isSecret: true,
        hint: 'Create a webhook endpoint in Stripe → Developers → Webhooks → Add endpoint. Use https://<your-domain>/api/billing/webhook. Subscribe to subscription + invoice events. Copy the signing secret here.' },
];

// Lider is the other way money reaches this platform: the customer's
// balance lives there, Lider decides whether they can afford something
// and deducts it, then calls our partner API to apply the result.
const LIDER_KEYS = [
    { key: 'LIDER_API_KEY', label: 'Lider Partner API Key', placeholder: 'a long random string', isSecret: true,
        hint: 'The shared secret Lider sends as "Authorization: Bearer <key>" on every partner call. Generate something long and random, paste it here, and give the same value to the Lider team. Changing it here immediately rejects calls using the old one.' },
    { key: 'LIDER_CONNECT_URL', label: 'Lider Connect URL', placeholder: 'https://lider.example.com/connect/chatbot', isSecret: false,
        hint: 'Where a user is sent to link their Lider account. We append ?token=… and &return_url=… — Lider signs the user in, calls POST /api/partner/lider/link with that token plus its own user id, then sends them back.' },
];

const ALL_KEYS = [...STRIPE_KEYS, ...LIDER_KEYS];

export default function AdminPaymentsPage() {
    const [values, setValues] = useState<Record<string, string>>({});
    const [updatedAt, setUpdatedAt] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    // Mirrors what is stored, so the floating save bar only appears
    // once a field genuinely differs from the server.
    const [baseline, setBaseline] = useState<Record<string, string>>({});
    const dirty = ALL_KEYS.some(k => (values[k.key] || '') !== (baseline[k.key] || ''));

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
                setBaseline(v);
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

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <h2 className="font-semibold">Lider</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Lets customers pay from their Lider balance. Leave blank to keep it switched off — the Connect
                        button stays hidden until both fields are set.
                    </p>
                </div>
                {LIDER_KEYS.map(k => (
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
                <div className="bg-secondary/30 border border-border rounded-xl p-3 text-xs space-y-1">
                    <p className="font-medium text-foreground">What to hand the Lider team</p>
                    <p className="text-muted-foreground">Base URL: <code className="bg-secondary px-1 rounded">https://chatbot.tural.ai/api/partner/lider</code></p>
                    <p className="text-muted-foreground">
                        <code className="bg-secondary px-1 rounded">GET /plans</code> · prices and limits, so Lider never keeps its own copy
                    </p>
                    <p className="text-muted-foreground">
                        <code className="bg-secondary px-1 rounded">POST /link</code> · finish a connect ({'{ token, liderUserId }'})
                    </p>
                    <p className="text-muted-foreground">
                        <code className="bg-secondary px-1 rounded">GET /account?liderUserId=</code> · current plan and credits
                    </p>
                    <p className="text-muted-foreground">
                        <code className="bg-secondary px-1 rounded">POST /purchase/plan</code> · {'{ liderUserId, planId, amountUsd, transactionId }'}
                    </p>
                    <p className="text-muted-foreground">
                        <code className="bg-secondary px-1 rounded">POST /purchase/credits</code> · {'{ liderUserId, amountUsd, transactionId }'}
                    </p>
                    <p className="text-muted-foreground pt-1">
                        Lider runs the balance check and deducts before calling. <code className="bg-secondary px-1 rounded">transactionId</code> is
                        Lider&apos;s own id and makes every call safe to retry — a repeat returns
                        <code className="bg-secondary px-1 rounded">alreadyApplied</code> and changes nothing.
                    </p>
                </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-3 text-sm">
                <h2 className="font-semibold">Stripe setup checklist</h2>
                <ol className="space-y-2 text-muted-foreground list-decimal pl-5">
                    <li>Create a Stripe account if you don't have one (<a className="text-primary hover:underline" href="https://dashboard.stripe.com/register" target="_blank" rel="noreferrer">dashboard.stripe.com <ExternalLink className="w-3 h-3 inline" /></a>).</li>
                    <li>In Stripe Dashboard → <span className="text-foreground">Developers → API keys</span>, copy the <span className="text-foreground">Secret key</span> and <span className="text-foreground">Publishable key</span>. Start with test mode.</li>
                    <li>For each Plan in <span className="text-foreground">Admin → Plans</span>, create a matching <span className="text-foreground">Product</span> and <span className="text-foreground">Price</span> in Stripe (Catalog → Products). Copy the Price ID (<code className="bg-secondary px-1 rounded">price_...</code>) into the plan's <span className="text-foreground">Stripe Price ID</span> field.</li>
                    <li>Go to <span className="text-foreground">Developers → Webhooks → Add endpoint</span>. Endpoint URL: <code className="bg-secondary px-1 rounded">https://chatbot.tural.ai/api/billing/webhook</code>. Subscribe to events: <code className="bg-secondary px-1 rounded">customer.subscription.created</code>, <code className="bg-secondary px-1 rounded">customer.subscription.updated</code>, <code className="bg-secondary px-1 rounded">customer.subscription.deleted</code>, <code className="bg-secondary px-1 rounded">invoice.paid</code>, <code className="bg-secondary px-1 rounded">invoice.payment_failed</code>.</li>
                    <li>Copy the webhook's <span className="text-foreground">Signing secret</span> (<code className="bg-secondary px-1 rounded">whsec_...</code>) into the field above.</li>
                    <li>Save. The next phase will wire actual Stripe Checkout into the user Billing page.</li>
                </ol>
            </div>

            <UnsavedChangesBar
                dirty={dirty}
                saving={saving}
                onSave={save}
                onDiscard={() => setValues(baseline)}
                label="Unsaved payment settings"
            />
        </div>
    );
}
