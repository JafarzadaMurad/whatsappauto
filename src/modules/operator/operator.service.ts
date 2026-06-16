import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { sessions } from '../whatsapp/instance.manager';

const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
const TICKET_LEN = 5;
const TICKET_REGEX = /\[REQ-([A-Z0-9]{5})\]/i;

function generateTicket(): string {
    let out = '';
    for (let i = 0; i < TICKET_LEN; i++) {
        out += TICKET_ALPHABET[Math.floor(Math.random() * TICKET_ALPHABET.length)];
    }
    return out;
}

function phoneFromJid(jid: string): string {
    return jid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/[^0-9]/g, '');
}

// Detect when an operator's "reply" is actually a question back to
// the agent rather than an answer to the customer. Without this check
// the composer happily takes "Ram neçə demişdik müştəriyə?" as the
// answer and hallucinates customer-facing video card specs out of
// thin air. Conservative: a strong "?" at the end is the dominant
// signal; a leading interrogative word is a fallback for messages
// that lack punctuation.
function looksLikeOperatorQuestion(text: string): boolean {
    const t = (text || '').trim();
    if (!t) return false;
    // Bare punctuation
    if (/[?؟？]\s*$/u.test(t)) return true;
    // Very short messages that lead with an interrogative are
    // almost always questions ("neçə?", "kim?", "сколько", "hangi").
    const head = t.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
    const interrogatives = [
        // Azerbaijani
        'neçə', 'hansı', 'nədir', 'nə idi', 'nə dedik', 'kimə', 'harda', 'haradadır', 'kim',
        'niyə', 'nəyə görə', 'neyləyim', 'demişdik', 'olarmı', 'varmı',
        // Russian
        'сколько', 'какой', 'какая', 'какое', 'кто', 'что', 'где', 'почему',
        'когда', 'как', 'кому',
        // Turkish
        'kaç', 'hangi', 'kim', 'ne kadar', 'nerede', 'neden', 'ne demiştik',
        // English
        'how many', 'how much', 'which', 'what', 'who', 'where', 'why', 'when',
    ];
    if (interrogatives.some(w => head.startsWith(w + ' ') || head === w)) return true;
    return false;
}

// Looks up the operator whose phone matches an incoming message's
// sender — scoped to ONE agent so a teammate registered as operator
// for agent A doesn't get intercepted when they happen to message
// some unrelated agent B's WhatsApp instance. agentId comes from the
// receiving Instance.agentId; if the instance has no agent assigned
// the caller will skip detection entirely.
export async function findOperatorByPhone(phone: string, agentId: string) {
    if (!phone || !agentId) return null;
    return prisma.operator.findFirst({
        where: { phone, agentId, isActive: true },
        include: { agent: { select: { id: true, name: true } } },
    });
}

// Send the operator a WhatsApp message with the embedded ticket
// header so their reply can be matched back. customerName / phone
// are included so the operator knows who they're answering about.
async function deliverToOperator(opts: {
    instanceId: string;
    operatorPhone: string;
    ticket: string;
    customerName: string | null;
    customerPhone: string | null;
    question: string;
    isEscalation?: boolean;
}) {
    const sock = sessions.get(opts.instanceId);
    if (!sock) {
        logger.warn(`[operator] cannot deliver — instance ${opts.instanceId} not connected`);
        return false;
    }
    const heading = opts.isEscalation
        ? `🔁 *Перенаправлено на вас* — [REQ-${opts.ticket}]`
        : `🆕 *Вопрос от агента* — [REQ-${opts.ticket}]`;
    const who = [opts.customerName, opts.customerPhone ? '+' + opts.customerPhone : null]
        .filter(Boolean).join(' · ') || 'Клиент';
    const body =
        `${heading}\n` +
        `👤 ${who}\n\n` +
        `${opts.question}\n\n` +
        `_Ответьте на это сообщение — система передаст ваш ответ клиенту. Если открыто несколько тикетов, начните ответ кодом *[REQ-${opts.ticket}]* или процитируйте это сообщение._`;
    const jid = `${opts.operatorPhone}@s.whatsapp.net`;
    logger.info(`[operator] → ${jid} ticket=${opts.ticket} (${body.length} chars)`);
    try {
        const result = await sock.sendMessage(jid, { text: body });
        logger.info(`[operator] sent ticket=${opts.ticket} msgId=${result?.key?.id || '?'} to ${jid}`);
        return true;
    } catch (e: any) {
        logger.warn({ err: e.message, stack: e.stack }, `[operator] send to ${jid} failed`);
        return false;
    }
}

// Agent invoked askOperator → create a request, deliver to the
// chosen operator, return the ticket so the agent can mention it in
// its reply to the customer if needed.
export async function createOperatorRequest(opts: {
    agentId: string;
    workspaceId: string | null;
    instanceId: string;
    operatorId: string;
    customerJid: string;
    customerName: string | null;
    customerPhone: string | null;
    question: string;
}) {
    const operator = await prisma.operator.findFirst({
        where: { id: opts.operatorId, agentId: opts.agentId, isActive: true },
    });
    if (!operator) {
        return { ok: false as const, error: 'Operator not found or inactive' };
    }
    const ticket = generateTicket();
    const timeoutAt = new Date(Date.now() + operator.timeoutMin * 60 * 1000);

    const request = await prisma.operatorRequest.create({
        data: {
            ticket, agentId: opts.agentId, workspaceId: opts.workspaceId,
            instanceId: opts.instanceId,
            customerJid: opts.customerJid,
            customerName: opts.customerName,
            customerPhone: opts.customerPhone,
            operatorId: operator.id,
            question: opts.question,
            status: 'open',
            timeoutAt,
        },
    });

    const delivered = await deliverToOperator({
        instanceId: opts.instanceId,
        operatorPhone: operator.phone,
        ticket,
        customerName: opts.customerName,
        customerPhone: opts.customerPhone,
        question: opts.question,
    });

    return {
        ok: true as const,
        ticket,
        requestId: request.id,
        operatorName: operator.name,
        operatorPhone: operator.phone,
        timeoutAt,
        delivered,
    };
}

// Match an incoming operator message to an open request. Strategy:
//   1. Explicit ticket code in the message body.
//   2. Quoted message body — scan that for a ticket code.
//   3. Single open request for this operator → unambiguous match.
//   4. Multiple open + no signal → return needsDialog so the caller
//      can ask the operator which one they meant.
export type OperatorMatchResult =
    | { kind: 'matched'; request: any }
    | { kind: 'no-open'; }
    | { kind: 'needs-dialog'; requests: any[] };

export async function matchOperatorReply(
    operatorId: string,
    body: string,
    quotedBody?: string
): Promise<OperatorMatchResult> {
    const explicit = body.match(TICKET_REGEX);
    if (explicit) {
        const ticket = explicit[1].toUpperCase();
        const req = await prisma.operatorRequest.findUnique({ where: { ticket } });
        if (req && req.operatorId === operatorId && req.status === 'open') {
            return { kind: 'matched', request: req };
        }
    }
    if (quotedBody) {
        const fromQuote = quotedBody.match(TICKET_REGEX);
        if (fromQuote) {
            const ticket = fromQuote[1].toUpperCase();
            const req = await prisma.operatorRequest.findUnique({ where: { ticket } });
            if (req && req.operatorId === operatorId && req.status === 'open') {
                return { kind: 'matched', request: req };
            }
        }
    }
    const open = await prisma.operatorRequest.findMany({
        where: { operatorId, status: 'open' },
        orderBy: { sentAt: 'desc' },
    });
    if (open.length === 0) return { kind: 'no-open' };
    if (open.length === 1) return { kind: 'matched', request: open[0] };
    return { kind: 'needs-dialog', requests: open };
}

// Mark a request as answered, store the operator's reply, return the
// info instance.manager needs to compose a reply for the customer.
export async function recordOperatorAnswer(requestId: string, answer: string) {
    const updated = await prisma.operatorRequest.update({
        where: { id: requestId },
        data: { answer, status: 'answered', answeredAt: new Date() },
    });
    return updated;
}

// Ask the operator which open ticket their reply was for. The agent
// won't generate a customer reply until the operator clarifies.
export async function askOperatorWhichTicket(
    instanceId: string,
    operatorPhone: string,
    openRequests: Array<{ ticket: string; customerName: string | null; customerPhone: string | null; question: string }>,
) {
    const sock = sessions.get(instanceId);
    if (!sock) return;
    const list = openRequests
        .slice(0, 5)
        .map(r => {
            const who = [r.customerName, r.customerPhone ? '+' + r.customerPhone : null].filter(Boolean).join(' · ') || 'Клиент';
            const preview = r.question.length > 80 ? r.question.slice(0, 80) + '…' : r.question;
            return `• [REQ-${r.ticket}] ${who}\n  _${preview}_`;
        }).join('\n\n');
    const body =
        `🤔 У вас сейчас несколько открытых запросов. На какой именно вы отвечаете?\n\n${list}\n\n` +
        `Ответьте, начав сообщение с кода (например *[REQ-${openRequests[0].ticket}] …ваш ответ…*) или процитируйте нужное сообщение.`;
    await sock.sendMessage(`${operatorPhone}@s.whatsapp.net`, { text: body }).catch(() => {});
}

// Periodic timeout sweeper. Finds requests whose timeoutAt is past,
// marks them as 'timeout', notifies the assigned operator, then
// re-routes to the next operator in the order. If no more operators
// remain, just notifies the customer's agent that the request expired.
export async function processTimeouts() {
    const now = new Date();
    const expired = await prisma.operatorRequest.findMany({
        where: { status: 'open', timeoutAt: { lte: now } },
        include: { operator: true },
        take: 20,
    });
    if (expired.length === 0) return;
    for (const req of expired) {
        try {
            // Notify the operator who timed out
            const sock = sessions.get(req.instanceId);
            if (sock && req.operator) {
                const note = `⏰ Тикет *[REQ-${req.ticket}]* истёк (нет ответа в течение ${req.operator.timeoutMin} мин). Запрос передан следующему оператору.`;
                await sock.sendMessage(`${req.operator.phone}@s.whatsapp.net`, { text: note }).catch(() => {});
            }

            // Find the next operator (higher order, not yet attempted)
            const attempted = [...(req.attemptedOpIds || []), req.operatorId];
            const next = await prisma.operator.findFirst({
                where: {
                    agentId: req.agentId,
                    isActive: true,
                    id: { notIn: attempted },
                },
                orderBy: { order: 'asc' },
            });

            if (!next) {
                // No more operators — close the request with a final timeout.
                await prisma.operatorRequest.update({
                    where: { id: req.id },
                    data: { status: 'timeout', attemptedOpIds: attempted },
                });
                logger.warn(`[operator] ticket ${req.ticket} exhausted operators — no escalation target`);
                continue;
            }

            // Re-route: move the request to the next operator, reset timeoutAt.
            const newTimeoutAt = new Date(Date.now() + next.timeoutMin * 60 * 1000);
            await prisma.operatorRequest.update({
                where: { id: req.id },
                data: {
                    operatorId: next.id,
                    timeoutAt: newTimeoutAt,
                    attemptedOpIds: attempted,
                },
            });
            await deliverToOperator({
                instanceId: req.instanceId,
                operatorPhone: next.phone,
                ticket: req.ticket,
                customerName: req.customerName,
                customerPhone: req.customerPhone,
                question: req.question,
                isEscalation: true,
            });
            logger.info(`[operator] ticket ${req.ticket} escalated to ${next.name} (${next.phone})`);
        } catch (e: any) {
            logger.warn({ err: e.message, ticket: req.ticket }, '[operator] timeout processing failed');
        }
    }
}

// Top-level entry from instance.manager when an incoming message is
// from someone registered as an Operator. Dispatches based on whether
// we can match the message to an open ticket. The async AI work
// (composing a customer-facing reply, answering an operator query) is
// delegated to AiService so prompt + tools + provider config stay in
// one place.
export async function handleOperatorMessage(opts: {
    instanceId: string;
    operator: any;
    body: string;
    quotedBody?: string | null;
}) {
    const { instanceId, operator, body, quotedBody } = opts;
    const match = await matchOperatorReply(operator.id, body, quotedBody || undefined);
    // Surface match kind so we can debug "operator answered but customer
    // got nothing" cases without re-running them through code analysis.
    logger.info(`[operator] match for ${operator.name} (${operator.phone}) on instance ${instanceId}: kind=${match.kind}` +
        (match.kind === 'matched' ? ` ticket=${match.request.ticket} customer=${match.request.customerJid}` :
         match.kind === 'needs-dialog' ? ` openCount=${match.requests.length}` : ''));

    if (match.kind === 'matched') {
        // Strip any leading [REQ-XXXX] header so the question heuristic
        // and the persisted answer don't include the ticket noise.
        const cleaned = body.replace(TICKET_REGEX, '').trim() || body;

        // If the operator quoted the ticket but actually asked a
        // question back (instead of answering it), don't close the
        // ticket and DON'T compose a customer reply — the composer
        // would hallucinate facts to "deliver". Route to Q&A mode so
        // the model can answer the operator's question using customer
        // history; the ticket stays open for the real answer.
        if (looksLikeOperatorQuestion(cleaned)) {
            logger.info(`[operator] ticket ${match.request.ticket} got a follow-up question from operator ("${cleaned.slice(0, 80)}") — keeping open, routing to Q&A`);
            const { AiService } = await import('../agent/ai.service');
            AiService.replyToOperatorQuery({
                instanceId, operator,
                question: cleaned,
                quotedBody: quotedBody || null,
            }).catch(err => logger.error({ err: err.message, ticket: match.request.ticket }, '[operator] Q&A from question-detection failed'));
            return;
        }

        const updated = await recordOperatorAnswer(match.request.id, cleaned);
        const { AiService } = await import('../agent/ai.service');
        AiService.composeCustomerReplyFromOperator({
            instanceId,
            request: updated,
            operatorAnswer: cleaned,
        }).catch(err => logger.error({ err: err.message, ticket: match.request.ticket }, '[operator] customer-reply composition failed'));
        return;
    }

    if (match.kind === 'needs-dialog') {
        await askOperatorWhichTicket(instanceId, operator.phone, match.requests);
        return;
    }

    // no-open → operator is chatting with the agent freely (asking
    // about a customer, requesting a forward, asking for stats). Pass
    // the quoted message through so the AI can derive context when
    // the operator quotes a customer thread.
    const { AiService } = await import('../agent/ai.service');
    AiService.replyToOperatorQuery({
        instanceId,
        operator,
        question: body,
        quotedBody: quotedBody || null,
    }).catch(err => logger.error({ err: err.message }, '[operator] Q&A reply failed'));
}

export function startOperatorTimeoutSweeper() {
    // Run once shortly after boot, then every minute. Lightweight
    // query keyed on the timeoutAt index, so even with hundreds of
    // open requests this stays cheap.
    setTimeout(processTimeouts, 15_000);
    setInterval(processTimeouts, 60_000);
}
