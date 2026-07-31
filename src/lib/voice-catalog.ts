// Voice pipeline catalogue — every transcriber, LLM, and TTS voice we
// currently plug into for phone calls. Each entry carries the info the
// editor UI displays (name, latency, cost, quality tier) AND the info
// the runtime bridge needs (provider slug, model id, per-unit pricing).
//
// Mirrors the shape Vapi's editor uses: three independently-picked
// components + preset bundles (Balanced / High Intelligence / Ultra
// Fast / Cost Saver) that snap all three at once.

export type Tier = 'Good' | 'Great' | 'Excellent' | 'Best';

export type TranscriberEntry = {
    provider: string;
    model: string;
    label: string;
    // USD per minute of audio transcribed. Streaming providers.
    costPerMin: number;
    // Approx end-of-utterance latency in ms.
    latencyMs: number;
    accuracy: Tier;
    // Languages the model is strong at; 'auto' means it detects itself.
    languages?: string[];
};

export type LlmEntry = {
    provider: string;       // 'openai' | 'anthropic' | 'google' | 'groq' | 'openai-realtime'
    model: string;
    label: string;
    inCostPer1M: number;
    outCostPer1M: number;
    // First-token latency in ms.
    latencyMs: number;
    intelligence: Tier;
    // True for OpenAI Realtime and similar — the model does STT + LLM
    // + TTS in one WebSocket. Bridge skips the discrete transcriber
    // and TTS entries when the LLM is speech-to-speech.
    combinesSttTts?: boolean;
};

export type TtsEntry = {
    provider: string;
    voiceId: string;
    label: string;
    // USD per 1M output characters — the industry billing unit for TTS.
    costPer1MChars: number;
    latencyMs: number;
    humanness: Tier;
    languages?: string[];
};

// Provider-level voice-model options (e.g. OpenAI ships tts-1 and tts-1-hd
// under the same voice ids). Rendered as the "Voice Model" dropdown in
// the voice settings drawer. Missing → the provider has only one model.
export type VoiceModelEntry = {
    provider: string;
    id: string;                  // e.g. 'tts-1', 'eleven_turbo_v2_5'
    label: string;
    costPer1MChars?: number;     // overrides the voice entry's cost when set
    isDefault?: boolean;
};

// ─── Transcribers (STT) ─────────────────────────────────────────────
export const TRANSCRIBERS: TranscriberEntry[] = [
    { provider: 'deepgram', model: 'nova-3',    label: 'Deepgram Nova 3',    costPerMin: 0.0052, latencyMs: 180, accuracy: 'Best',      languages: ['en', 'ru', 'tr', 'de', 'fr', 'es'] },
    { provider: 'deepgram', model: 'nova-2',    label: 'Deepgram Nova 2',    costPerMin: 0.0043, latencyMs: 200, accuracy: 'Excellent', languages: ['en', 'ru', 'tr', 'de', 'fr', 'es'] },
    { provider: 'openai',   model: 'gpt-4o-transcribe',      label: 'GPT-4o Transcribe',        costPerMin: 0.012, latencyMs: 400, accuracy: 'Excellent' },
    { provider: 'openai',   model: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe',  costPerMin: 0.008, latencyMs: 350, accuracy: 'Great' },
    { provider: 'openai',   model: 'whisper-1',              label: 'OpenAI Whisper',           costPerMin: 0.006, latencyMs: 900, accuracy: 'Great' },
    { provider: 'assemblyai', model: 'universal-streaming',  label: 'AssemblyAI Universal',    costPerMin: 0.0037, latencyMs: 300, accuracy: 'Excellent' },
    { provider: 'gladia',   model: 'solaria-1',              label: 'Gladia Solaria',           costPerMin: 0.0060, latencyMs: 350, accuracy: 'Great' },
    { provider: 'speechmatics', model: 'ursa',               label: 'Speechmatics Ursa',        costPerMin: 0.0050, latencyMs: 250, accuracy: 'Excellent' },
    { provider: 'soniox',   model: 'stt-rt-v5',              label: 'Soniox v5',                costPerMin: 0.0067, latencyMs: 220, accuracy: 'Excellent' },
];

// ─── LLMs ──────────────────────────────────────────────────────────
export const LLMS: LlmEntry[] = [
    // Speech-to-speech models (skip transcriber + TTS layers)
    { provider: 'openai-realtime', model: 'gpt-realtime',       label: 'GPT Realtime',       inCostPer1M: 32, outCostPer1M: 64, latencyMs: 500, intelligence: 'Great',     combinesSttTts: true },
    { provider: 'openai-realtime', model: 'gpt-realtime-mini',  label: 'GPT Realtime Mini',  inCostPer1M: 10, outCostPer1M: 20, latencyMs: 500, intelligence: 'Good',      combinesSttTts: true },
    // OpenAI text LLMs (used behind Deepgram STT + Cartesia/OpenAI TTS)
    { provider: 'openai', model: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol',   inCostPer1M: 5,    outCostPer1M: 30,  latencyMs: 700, intelligence: 'Best' },
    { provider: 'openai', model: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', inCostPer1M: 2.5,  outCostPer1M: 15,  latencyMs: 500, intelligence: 'Excellent' },
    { provider: 'openai', model: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna',  inCostPer1M: 1,    outCostPer1M: 6,   latencyMs: 350, intelligence: 'Great' },
    { provider: 'openai', model: 'gpt-5.5',       label: 'GPT-5.5',       inCostPer1M: 3,    outCostPer1M: 18,  latencyMs: 650, intelligence: 'Excellent' },
    { provider: 'openai', model: 'gpt-5.5-pro',   label: 'GPT-5.5 Pro',   inCostPer1M: 8,    outCostPer1M: 40,  latencyMs: 900, intelligence: 'Best' },
    { provider: 'openai', model: 'gpt-5.4',       label: 'GPT-5.4',       inCostPer1M: 1.5,  outCostPer1M: 9,   latencyMs: 450, intelligence: 'Great' },
    { provider: 'openai', model: 'gpt-5.4-mini',  label: 'GPT-5.4 Mini',  inCostPer1M: 0.75, outCostPer1M: 4.5, latencyMs: 300, intelligence: 'Good' },
    { provider: 'openai', model: 'gpt-5.4-nano',  label: 'GPT-5.4 Nano',  inCostPer1M: 0.2,  outCostPer1M: 1.25, latencyMs: 250, intelligence: 'Good' },
    { provider: 'openai', model: 'gpt-4o',        label: 'GPT-4o',        inCostPer1M: 2.5,  outCostPer1M: 10,  latencyMs: 500, intelligence: 'Great' },
    { provider: 'openai', model: 'gpt-4o-mini',   label: 'GPT-4o Mini',   inCostPer1M: 0.15, outCostPer1M: 0.6, latencyMs: 300, intelligence: 'Good' },
    // Anthropic
    { provider: 'anthropic', model: 'claude-opus-4-8',           label: 'Claude Opus 4.8',   inCostPer1M: 5, outCostPer1M: 25, latencyMs: 800, intelligence: 'Best' },
    { provider: 'anthropic', model: 'claude-sonnet-5',           label: 'Claude Sonnet 5',   inCostPer1M: 2, outCostPer1M: 10, latencyMs: 500, intelligence: 'Excellent' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  inCostPer1M: 1, outCostPer1M: 5,  latencyMs: 350, intelligence: 'Great' },
    // Google
    { provider: 'google', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', inCostPer1M: 0.30, outCostPer1M: 2.50, latencyMs: 400, intelligence: 'Great' },
    { provider: 'google', model: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   inCostPer1M: 1.25, outCostPer1M: 10,   latencyMs: 600, intelligence: 'Excellent' },
    // Groq (blazing latency, older weights)
    { provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', inCostPer1M: 0.59, outCostPer1M: 0.79, latencyMs: 120, intelligence: 'Great' },
];

// ─── TTS voice models (provider-scoped) ────────────────────────────
export const VOICE_MODELS: VoiceModelEntry[] = [
    { provider: 'openai',     id: 'tts-1',                    label: 'TTS 1 (default)',          costPer1MChars: 15, isDefault: true },
    { provider: 'openai',     id: 'tts-1-hd',                 label: 'TTS 1 HD',                 costPer1MChars: 30 },
    { provider: 'elevenlabs', id: 'eleven_turbo_v2_5',        label: 'Turbo v2.5 (fastest)',     costPer1MChars: 50, isDefault: true },
    { provider: 'elevenlabs', id: 'eleven_multilingual_v2',   label: 'Multilingual v2',          costPer1MChars: 90 },
    { provider: 'elevenlabs', id: 'eleven_flash_v2_5',        label: 'Flash v2.5 (75ms latency)', costPer1MChars: 50 },
    { provider: 'cartesia',   id: 'sonic-2',                  label: 'Sonic 2 (default)',        costPer1MChars: 65, isDefault: true },
    { provider: 'cartesia',   id: 'sonic-turbo',              label: 'Sonic Turbo',              costPer1MChars: 35 },
    { provider: 'deepgram',   id: 'aura-2',                   label: 'Aura 2',                   costPer1MChars: 15, isDefault: true },
    { provider: 'playht',     id: 'play-3-mini',              label: 'Play 3 Mini',              costPer1MChars: 45, isDefault: true },
    { provider: 'playht',     id: 'play-3.0',                 label: 'Play 3.0',                 costPer1MChars: 80 },
    { provider: 'azure',      id: 'neural',                   label: 'Neural',                   costPer1MChars: 16, isDefault: true },
];

export function findVoiceModel(provider: string, id?: string | null) {
    if (!id) return VOICE_MODELS.find(m => m.provider === provider && m.isDefault) || null;
    return VOICE_MODELS.find(m => m.provider === provider && m.id === id) || null;
}

export function voiceModelsFor(provider: string) {
    return VOICE_MODELS.filter(m => m.provider === provider);
}

// ─── TTS voices ────────────────────────────────────────────────────
export const VOICES: TtsEntry[] = [
    // OpenAI (cheap, GA-quality)
    { provider: 'openai', voiceId: 'alloy',   label: 'Alloy (OpenAI)',   costPer1MChars: 15, latencyMs: 400, humanness: 'Great' },
    { provider: 'openai', voiceId: 'ash',     label: 'Ash (OpenAI)',     costPer1MChars: 15, latencyMs: 400, humanness: 'Great' },
    { provider: 'openai', voiceId: 'ballad',  label: 'Ballad (OpenAI)',  costPer1MChars: 15, latencyMs: 400, humanness: 'Great' },
    { provider: 'openai', voiceId: 'coral',   label: 'Coral (OpenAI)',   costPer1MChars: 15, latencyMs: 400, humanness: 'Great' },
    { provider: 'openai', voiceId: 'echo',    label: 'Echo (OpenAI)',    costPer1MChars: 15, latencyMs: 400, humanness: 'Great' },
    { provider: 'openai', voiceId: 'sage',    label: 'Sage (OpenAI)',    costPer1MChars: 15, latencyMs: 400, humanness: 'Great' },
    { provider: 'openai', voiceId: 'shimmer', label: 'Shimmer (OpenAI)', costPer1MChars: 15, latencyMs: 400, humanness: 'Great' },
    // ElevenLabs (top-tier human, expensive)
    { provider: 'elevenlabs', voiceId: 'rachel',     label: 'Rachel (ElevenLabs)',     costPer1MChars: 90, latencyMs: 300, humanness: 'Best' },
    { provider: 'elevenlabs', voiceId: 'adam',       label: 'Adam (ElevenLabs)',       costPer1MChars: 90, latencyMs: 300, humanness: 'Best' },
    { provider: 'elevenlabs', voiceId: 'antoni',     label: 'Antoni (ElevenLabs)',     costPer1MChars: 90, latencyMs: 300, humanness: 'Best' },
    { provider: 'elevenlabs', voiceId: 'bella',      label: 'Bella (ElevenLabs)',      costPer1MChars: 90, latencyMs: 300, humanness: 'Best' },
    // Cartesia Sonic (industry-leading latency)
    { provider: 'cartesia', voiceId: 'sonic-english',  label: 'Sonic English (Cartesia)',  costPer1MChars: 65, latencyMs: 90,  humanness: 'Excellent' },
    { provider: 'cartesia', voiceId: 'sonic-multilingual', label: 'Sonic Multilingual (Cartesia)', costPer1MChars: 65, latencyMs: 90, humanness: 'Excellent', languages: ['en', 'ru', 'tr', 'de', 'fr', 'es'] },
    // Deepgram Aura (cheap + fast)
    { provider: 'deepgram', voiceId: 'aura-asteria-en', label: 'Aura Asteria (Deepgram)', costPer1MChars: 15, latencyMs: 200, humanness: 'Good' },
    { provider: 'deepgram', voiceId: 'aura-luna-en',    label: 'Aura Luna (Deepgram)',    costPer1MChars: 15, latencyMs: 200, humanness: 'Good' },
    { provider: 'deepgram', voiceId: 'aura-stella-en',  label: 'Aura Stella (Deepgram)',  costPer1MChars: 15, latencyMs: 200, humanness: 'Good' },
    // PlayHT (large voice catalog)
    { provider: 'playht', voiceId: 'jennifer', label: 'Jennifer (PlayHT)', costPer1MChars: 80, latencyMs: 350, humanness: 'Excellent' },
    // Azure Neural (multilingual sweep incl AZ / RU / TR / EN)
    { provider: 'azure', voiceId: 'az-AZ-BabekNeural',   label: 'Babək (Azure AZ)',   costPer1MChars: 16, latencyMs: 400, humanness: 'Great', languages: ['az'] },
    { provider: 'azure', voiceId: 'az-AZ-BanuNeural',    label: 'Banu (Azure AZ)',    costPer1MChars: 16, latencyMs: 400, humanness: 'Great', languages: ['az'] },
    { provider: 'azure', voiceId: 'ru-RU-SvetlanaNeural', label: 'Svetlana (Azure RU)', costPer1MChars: 16, latencyMs: 400, humanness: 'Great', languages: ['ru'] },
    { provider: 'azure', voiceId: 'tr-TR-EmelNeural',    label: 'Emel (Azure TR)',    costPer1MChars: 16, latencyMs: 400, humanness: 'Great', languages: ['tr'] },
];

// ─── Presets ────────────────────────────────────────────────────────
// The 4 combos Vapi ships. `format: "provider:model|voiceId"`.
export type Preset = {
    key: 'balanced' | 'high-intelligence' | 'ultra-fast' | 'cost-saver';
    label: string;
    hint: string;
    transcriber: string; // "provider:model"
    llm: string;
    tts: string;         // "provider:voiceId"
};

export const PRESETS: Preset[] = [
    {
        key: 'balanced', label: 'Balanced', hint: 'Sensible defaults for most use cases.',
        transcriber: 'deepgram:nova-3',
        llm: 'openai:gpt-5.6-luna',
        tts: 'openai:alloy',
    },
    {
        key: 'high-intelligence', label: 'High Intelligence', hint: 'Best model + most human voice. Slower and pricier.',
        transcriber: 'openai:gpt-4o-transcribe',
        llm: 'openai:gpt-5.6-terra',
        tts: 'elevenlabs:rachel',
    },
    {
        key: 'ultra-fast', label: 'Ultra Fast', hint: 'Sub-500ms voice-to-voice via OpenAI Realtime (skips discrete STT/TTS).',
        transcriber: 'openai:gpt-4o-transcribe',
        llm: 'openai-realtime:gpt-realtime',
        tts: 'openai:alloy',
    },
    {
        key: 'cost-saver', label: 'Cost Saver', hint: 'Cheapest combo that still sounds natural.',
        transcriber: 'deepgram:nova-2',
        llm: 'openai:gpt-5.4-mini',
        tts: 'deepgram:aura-asteria-en',
    },
];

// ─── Lookup + cost helpers ─────────────────────────────────────────

export function findTranscriber(provider: string, model: string) {
    return TRANSCRIBERS.find(t => t.provider === provider && t.model === model) || null;
}
export function findLlm(provider: string, model: string) {
    return LLMS.find(l => l.provider === provider && l.model === model) || null;
}
export function findVoice(provider: string, voiceId: string) {
    return VOICES.find(v => v.provider === provider && v.voiceId === voiceId) || null;
}

// ─── Language catalogue ────────────────────────────────────────────
// Editor renders this list in the transcriber drawer's Language
// dropdown. `null`-value first entry = auto-detect (Vapi's default).
export const LANGUAGES: { code: string; label: string; nativeName: string }[] = [
    { code: 'en', label: 'English',    nativeName: 'English' },
    { code: 'az', label: 'Azerbaijani', nativeName: 'Azərbaycan' },
    { code: 'ru', label: 'Russian',    nativeName: 'Русский' },
    { code: 'tr', label: 'Turkish',    nativeName: 'Türkçe' },
    { code: 'de', label: 'German',     nativeName: 'Deutsch' },
    { code: 'fr', label: 'French',     nativeName: 'Français' },
    { code: 'es', label: 'Spanish',    nativeName: 'Español' },
    { code: 'it', label: 'Italian',    nativeName: 'Italiano' },
    { code: 'pt', label: 'Portuguese', nativeName: 'Português' },
    { code: 'nl', label: 'Dutch',      nativeName: 'Nederlands' },
    { code: 'pl', label: 'Polish',     nativeName: 'Polski' },
    { code: 'ar', label: 'Arabic',     nativeName: 'العربية' },
    { code: 'hi', label: 'Hindi',      nativeName: 'हिन्दी' },
    { code: 'ja', label: 'Japanese',   nativeName: '日本語' },
    { code: 'ko', label: 'Korean',     nativeName: '한국어' },
    { code: 'zh', label: 'Chinese',    nativeName: '中文' },
    { code: 'uk', label: 'Ukrainian',  nativeName: 'Українська' },
    { code: 'fa', label: 'Persian',    nativeName: 'فارسی' },
    { code: 'he', label: 'Hebrew',     nativeName: 'עברית' },
];

// PSTN carrier baseline — Twilio US number. International inbound calls
// vary; the runtime bridge tracks the real per-call cost and stores it
// on PhoneCall.telephonyCostUsd, but the editor preview uses this.
export const TELEPHONY_COST_PER_MIN = 0.009;

/**
 * Estimate what one minute of conversation costs on this pipeline.
 * Heuristic based on a typical exchange: ~150 words in + ~120 words out
 * per minute → ~200 tokens in / ~160 tokens out for the LLM, ~800 chars
 * spoken by TTS. Speech-to-speech models bypass discrete transcriber
 * and TTS costs.
 */
export function estimateCostPerMinute(input: {
    transcriber: string;   // "provider:model"
    llm: string;
    tts: string;           // "provider:voiceId"
}): {
    transcriberUsd: number;
    llmUsd: number;
    ttsUsd: number;
    telephonyUsd: number;
    totalUsd: number;
    latencyMs: number;
} {
    const [tProv, tModel] = input.transcriber.split(':');
    const [lProv, lModel] = input.llm.split(':');
    const [vProv, vVoice] = input.tts.split(':');

    const trans = findTranscriber(tProv, tModel);
    const llm = findLlm(lProv, lModel);
    const voice = findVoice(vProv, vVoice);

    const combined = !!llm?.combinesSttTts;

    // Realtime bundle prices audio tokens (~100 per audio-second).
    // A minute of user audio in + agent audio out at typical density:
    // input ~1500 tokens (mostly system + user), output ~1500 tokens.
    // Use a conservative 2 500 in / 2 500 out per minute of active chat.
    const llmUsd = llm
        ? combined
            ? (2500 / 1_000_000) * llm.inCostPer1M + (2500 / 1_000_000) * llm.outCostPer1M
            : (200 / 1_000_000) * llm.inCostPer1M + (160 / 1_000_000) * llm.outCostPer1M
        : 0;

    const transcriberUsd = trans && !combined ? trans.costPerMin : 0;
    const ttsUsd = voice && !combined ? (800 / 1_000_000) * voice.costPer1MChars : 0;
    const telephonyUsd = TELEPHONY_COST_PER_MIN;

    const totalUsd = transcriberUsd + llmUsd + ttsUsd + telephonyUsd;
    // Rough end-to-end latency = worst-case sum. Combined models skip
    // the STT + TTS hops so they win here even at 500 ms LLM latency.
    const latencyMs = combined
        ? (llm?.latencyMs || 500) + telephonyLatency()
        : (trans?.latencyMs || 300) + (llm?.latencyMs || 400) + (voice?.latencyMs || 300) + telephonyLatency();

    return { transcriberUsd, llmUsd, ttsUsd, telephonyUsd, totalUsd, latencyMs };
}

function telephonyLatency() {
    // Twilio media-streams round-trip typically ~80-120 ms.
    return 100;
}
