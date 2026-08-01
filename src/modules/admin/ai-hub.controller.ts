// The AI hub descriptor — one place that answers "which AI providers
// does this platform know about, and what does each one own?".
//
// Admin used to have three separate screens for this: AI Models (the
// text catalogue users pick from), Platform Keys (the master API keys)
// and AI Pricing (per-model rates). All three are facets of the same
// object — a provider — and keeping them apart meant an admin had to
// remember, for instance, that ticking a Deepgram voice on one screen
// does nothing until a key is pasted on another. This endpoint returns
// the merged view so the UI can render a provider at a time.
//
// The descriptor is deliberately assembled from the same sources the
// runtime uses (PLATFORM_KEY_MAP, the voice catalogue, the text model
// catalogue) rather than restated: a provider added to the catalogue
// shows up here without anyone editing this file.

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { PLATFORM_KEY_FOR } from '../../lib/ai-pricing';
import { TRANSCRIBERS, LLMS, VOICES, VOICE_MODELS } from '../../lib/voice-catalog';
import { loadCatalog } from '../../lib/model-access';

// Human-facing chrome per provider. Anything not listed still appears
// (see `fallbackMeta`) — this table only makes the common ones nicer.
const META: Record<string, { label: string; blurb: string; placeholder: string; docsUrl?: string }> = {
    openai: {
        label: 'OpenAI', blurb: 'GPT chat models, Whisper / GPT-4o transcription, TTS voices and the Realtime speech-to-speech API.',
        placeholder: 'sk-…', docsUrl: 'https://platform.openai.com/api-keys',
    },
    'openai-realtime': {
        label: 'OpenAI Realtime', blurb: 'Speech-to-speech models used by the voice bridge. Shares OpenAI\'s key.',
        placeholder: 'sk-…',
    },
    anthropic: {
        label: 'Anthropic', blurb: 'Claude models — the default for agent replies on most plans.',
        placeholder: 'sk-ant-…', docsUrl: 'https://console.anthropic.com/settings/keys',
    },
    google: {
        label: 'Google', blurb: 'Gemini models.',
        placeholder: 'AIza…', docsUrl: 'https://aistudio.google.com/apikey',
    },
    zai: {
        label: 'Z.ai (GLM)', blurb: 'GLM models via Z.ai\'s OpenAI-compatible endpoint.',
        placeholder: 'zai-…', docsUrl: 'https://z.ai/manage-apikey/apikey-list',
    },
    groq: {
        label: 'Groq', blurb: 'Ultra-low-latency Llama inference. Only needed if the voice catalogue lists Groq LLMs.',
        placeholder: 'gsk_…',
    },
    deepgram: {
        label: 'Deepgram', blurb: 'Nova transcribers and Aura TTS voices — one key unlocks both.',
        placeholder: 'dg-…',
    },
    assemblyai: { label: 'AssemblyAI', blurb: 'Universal streaming speech-to-text.', placeholder: 'aa-…' },
    gladia: { label: 'Gladia', blurb: 'Solaria streaming speech-to-text.', placeholder: 'gld-…' },
    speechmatics: { label: 'Speechmatics', blurb: 'Ursa streaming speech-to-text.', placeholder: 'sm-…' },
    soniox: { label: 'Soniox', blurb: 'Soniox v5 real-time speech-to-text.', placeholder: 'sx-…' },
    elevenlabs: { label: 'ElevenLabs', blurb: 'Top-tier human TTS voices. The most expensive leg of a voice call.', placeholder: 'el-…' },
    cartesia: { label: 'Cartesia', blurb: 'Sonic 2 TTS — roughly 90 ms voice-to-voice latency.', placeholder: 'crt-…' },
    playht: { label: 'PlayHT', blurb: 'Play 3 TTS voices.', placeholder: 'userId|apiKey' },
    azure: { label: 'Azure Speech', blurb: 'Azure Neural TTS voices.', placeholder: 'apiKey|region' },
};

// Two providers need a composite value; say so where it's typed rather
// than in a footnote nobody reads.
const COMPOSITE_HINT: Record<string, string> = {
    playht: 'Paste as userId|apiKey — PlayHT authenticates with both.',
    azure: 'Paste as apiKey|region (e.g. …|eastus) — Azure needs the region.',
};

// Which bucket of the *text* model catalogue a provider owns, if any.
// That catalogue is keyed by the legacy uppercase provider names.
const CATALOGUE_BUCKET: Record<string, 'OPENAI' | 'CLAUDE' | 'GEMINI' | 'GLM'> = {
    openai: 'OPENAI',
    anthropic: 'CLAUDE',
    google: 'GEMINI',
    zai: 'GLM',
};

// AiPricing rows a provider owns. Realtime is filed under `openai` in
// the pricing table but referenced as `openai-realtime` by the voice
// catalogue, so OpenAI's card claims both.
const EXTRA_PRICING_IDS: Record<string, string[]> = {
    openai: ['openai-realtime'],
};

const fallbackMeta = (id: string) => ({
    label: id.replace(/(^|[-_])(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase()),
    blurb: 'Discovered from the voice catalogue.',
    placeholder: 'API key',
    docsUrl: undefined as string | undefined,
});

export class AiHubController {
    async overview(_req: Request, res: Response) {
        try {
            // Every provider the platform knows about, from any source.
            const ids = Array.from(new Set<string>([
                ...Object.keys(CATALOGUE_BUCKET),
                ...TRANSCRIBERS.map(t => t.provider),
                ...LLMS.map(l => l.provider),
                ...VOICES.map(v => v.provider),
                ...VOICE_MODELS.map(v => v.provider),
            ].map(p => p.toLowerCase())))
                // Realtime is a facet of OpenAI, not a card of its own —
                // it has no key and no models a user picks separately.
                .filter(id => id !== 'openai-realtime');

            const [catalogue, pricingRows, configRows] = await Promise.all([
                loadCatalog(),
                prisma.aiPricing.findMany({ orderBy: [{ provider: 'asc' }, { model: 'asc' }] }),
                prisma.systemConfig.findMany({ where: { key: { startsWith: 'PLATFORM_' } } }),
            ]);
            const configByKey = new Map(configRows.map(r => [r.key, r]));

            const providers = ids.map(id => {
                const meta = META[id] ?? fallbackMeta(id);
                const configKey = PLATFORM_KEY_FOR(id) ?? null;
                const cfg = configKey ? configByKey.get(configKey) : undefined;
                const bucket = CATALOGUE_BUCKET[id];
                const pricingIds = [id, ...(EXTRA_PRICING_IDS[id] ?? [])];

                const transcribers = TRANSCRIBERS.filter(t => t.provider === id);
                const voiceLlms = LLMS.filter(l => pricingIds.includes(l.provider));
                const voices = VOICES.filter(v => v.provider === id);
                const voiceModels = VOICE_MODELS.filter(v => v.provider === id);

                const capabilities: string[] = [];
                if (bucket) capabilities.push('text');
                if (transcribers.length) capabilities.push('stt');
                if (voiceLlms.length) capabilities.push('voice-llm');
                if (voices.length) capabilities.push('tts');

                return {
                    id,
                    label: meta.label,
                    blurb: meta.blurb,
                    docsUrl: meta.docsUrl ?? null,
                    capabilities,
                    // Key
                    configKey,
                    keyPlaceholder: meta.placeholder,
                    keyHint: COMPOSITE_HINT[id] ?? null,
                    keySet: !!(cfg?.value || '').trim(),
                    keyUpdatedAt: cfg?.updatedAt ?? null,
                    // Text catalogue (what a user can pick for an agent)
                    catalogueBucket: bucket ?? null,
                    catalogueModels: bucket ? (catalogue[bucket] ?? []) : [],
                    // Pricing
                    pricingIds,
                    pricingCount: pricingRows.filter(r => pricingIds.includes(r.provider.toLowerCase())).length,
                    // Voice catalogue (read-only — edited in code, priced here)
                    voice: {
                        transcribers: transcribers.map(t => ({ model: t.model, label: t.label, costPerMin: t.costPerMin })),
                        llms: voiceLlms.map(l => ({
                            provider: l.provider, model: l.model, label: l.label,
                            inCostPer1M: l.inCostPer1M, outCostPer1M: l.outCostPer1M,
                            combinesSttTts: !!l.combinesSttTts,
                        })),
                        voices: voices.map(v => ({ voiceId: v.voiceId, label: v.label, costPer1MChars: v.costPer1MChars })),
                        voiceModels: voiceModels.map(v => ({ id: v.id, label: v.label, costPer1MChars: v.costPer1MChars ?? null })),
                    },
                };
            });

            // Configured first, then the ones carrying the most models —
            // an admin opening this page wants the live providers on top.
            providers.sort((a, b) => {
                if (a.keySet !== b.keySet) return a.keySet ? -1 : 1;
                return b.capabilities.length - a.capabilities.length || a.label.localeCompare(b.label);
            });

            return res.json({ success: true, providers, pricing: pricingRows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}
