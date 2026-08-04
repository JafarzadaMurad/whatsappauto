// Post-call summary.
//
// A transcript is evidence, not information. Nobody scrolls through
// forty turns of "uh-huh" to find out whether the customer agreed to
// anything — so the moment a call ends we ask a model to say what it
// was about, what was decided, and what still needs doing. The
// transcript stays underneath as the proof.
//
// Written as fire-and-forget: the bridge has already torn the call
// down by the time this runs, and a summary that fails is worth a
// logged warning, never a broken call record.

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { runAgentGenerate } from '../../lib/ai-runner';
import { resolvePlatformKey } from '../../lib/ai-pricing';

// Deliberately a small model. This is a short, mechanical job run on
// every single call, so the cost of picking a flagship here multiplies
// by call volume for no gain in quality.
const DEFAULT_PROVIDER = 'OPENAI';
const DEFAULT_MODEL = 'gpt-5.4-mini';

type Turn = { role?: string; text?: string; at?: number };

function renderTranscript(turns: Turn[]): string {
    return turns
        .filter(t => (t.text || '').trim())
        .map(t => `${t.role === 'assistant' ? 'Assistant' : 'Caller'}: ${String(t.text).trim()}`)
        .join('\n');
}

const SYSTEM = [
    'You summarise recorded phone calls for a business operator.',
    'Write for someone who was not on the call and will not listen to it.',
    '',
    'Answer in the language the call was held in.',
    '',
    'Structure the summary as short labelled lines, in this order,',
    'skipping any line you have nothing real to put on:',
    '  Why they called — one sentence.',
    '  What was agreed — decisions, bookings, commitments, prices quoted.',
    '  Follow-up — anything the business still owes the caller.',
    '  Note — anything the operator would want flagged (complaint, confusion,',
    '  the assistant failing to answer something).',
    '',
    'Be specific: names, dates, amounts, order numbers as they were said.',
    'Never invent a detail that is not in the transcript. If the call carries',
    'nothing of substance — a wrong number, silence, an immediate hang-up —',
    'say exactly that in one line and stop.',
].join('\n');

/** The model an operator's summaries run on, admin-overridable. */
async function loadSummaryModel(): Promise<{ provider: string; model: string }> {
    const [p, m] = await Promise.all([
        prisma.systemConfig.findUnique({ where: { key: 'VOICE_SUMMARY_PROVIDER' } }),
        prisma.systemConfig.findUnique({ where: { key: 'VOICE_SUMMARY_MODEL' } }),
    ]);
    return {
        provider: p?.value?.trim() || DEFAULT_PROVIDER,
        model: m?.value?.trim() || DEFAULT_MODEL,
    };
}

/**
 * Summarise one call. Safe to call more than once — an existing
 * summary is left alone unless `force` is set, so a retry after a
 * transient failure doesn't spend credits re-summarising work that
 * already succeeded.
 */
export async function summariseCall(callId: string, opts: { force?: boolean } = {}): Promise<string | null> {
    const call = await prisma.phoneCall.findUnique({
        where: { id: callId },
        select: {
            id: true, workspaceId: true, transcript: true, summary: true,
            durationSec: true, direction: true, endedReason: true,
            voiceAssistant: { select: { name: true } },
        },
    });
    if (!call) return null;
    if (call.summary && !opts.force) return call.summary;

    const turns = Array.isArray(call.transcript) ? (call.transcript as any as Turn[]) : [];
    const body = renderTranscript(turns);

    // A call with nothing said doesn't need a model to describe it, and
    // paying for one on every hang-up would be a slow leak.
    if (!body.trim()) {
        const note = call.durationSec && call.durationSec > 0
            ? 'No speech was captured on this call.'
            : 'The call ended before anyone spoke.';
        await prisma.phoneCall.update({
            where: { id: call.id },
            data: { summary: note, summaryAt: new Date(), summaryStatus: 'empty' },
        }).catch(() => {});
        return note;
    }

    const { provider, model } = await loadSummaryModel();
    const apiKey = await resolvePlatformKey(provider);
    if (!apiKey) {
        logger.warn({ callId, provider }, '[voice-summary] no platform key — skipping');
        await prisma.phoneCall.update({
            where: { id: call.id },
            data: { summaryStatus: 'failed', summary: `No ${provider} platform key configured.` },
        }).catch(() => {});
        return null;
    }

    const context = [
        `Assistant: ${call.voiceAssistant?.name || 'unnamed'}`,
        `Direction: ${call.direction}`,
        call.durationSec != null ? `Duration: ${call.durationSec}s` : null,
        call.endedReason ? `Ended: ${call.endedReason}` : null,
    ].filter(Boolean).join(' · ');

    try {
        const res: any = await runAgentGenerate({
            workspaceId: call.workspaceId,
            userId: null,
            providerInfo: { provider, apiKey, useOwnKey: false },
            model,
            cause: 'other',
            system: SYSTEM,
            prompt: `${context}\n\nTranscript:\n${body}`,
        });

        const text = String(res?.text || '').trim();
        if (!text) throw new Error('model returned nothing');

        await prisma.phoneCall.update({
            where: { id: call.id },
            data: { summary: text, summaryModel: `${provider}/${model}`, summaryAt: new Date(), summaryStatus: 'ready' },
        });
        logger.info({ callId, model }, '[voice-summary] summary written');
        return text;
    } catch (err: any) {
        // Out of credits is the common case and isn't an error worth
        // shouting about — the operator sees why on the call itself.
        logger.warn({ callId, err: err.message }, '[voice-summary] failed');
        await prisma.phoneCall.update({
            where: { id: call.id },
            data: { summaryStatus: 'failed', summary: `Could not summarise: ${err.message}` },
        }).catch(() => {});
        return null;
    }
}

/**
 * Queue a summary without making the caller wait. The bridge calls
 * this as the last thing it does; nothing downstream depends on the
 * result, so a rejection here must not surface.
 */
export function queueCallSummary(callId: string) {
    setTimeout(() => {
        void summariseCall(callId).catch(err =>
            logger.warn({ callId, err: err?.message }, '[voice-summary] queued job failed'));
    }, 250).unref?.();
}
