import { Queue, Worker } from 'bullmq';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { sessions } from '../whatsapp/instance.manager';
import { recordUsagePostHoc } from '../../lib/credit-guard';
import IORedis from 'ioredis';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const campaignQueue = new Queue('campaign-outbound', { connection });

export const startCampaignWorker = () => {
    const worker = new Worker('campaign-outbound', async job => {
        const { recipientId, campaignId } = job.data;

        const recipient = await prisma.campaignRecipient.findUnique({
            where: { id: recipientId },
            include: {
                campaign: {
                    include: {
                        agent: { include: { provider: true } },
                        instance: true
                    }
                }
            }
        });

        if (!recipient || recipient.status !== 'PENDING') return;

        const campaign = recipient.campaign;
        // Scheduled campaigns start PENDING and flip to RUNNING at
        // scheduledFor. If we fire before that, do it now.
        if (campaign.status === 'PENDING' && campaign.scheduledFor && campaign.scheduledFor <= new Date()) {
            await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
            campaign.status = 'RUNNING';
        }
        if (campaign.status !== 'RUNNING') return;

        const agent = campaign.agent;
        // Agent or instance may have been deleted after the campaign was
        // created (we use SetNull on delete so the campaign itself
        // survives). Fail the recipient gracefully.
        if (!agent || !campaign.instanceId) {
            await prisma.campaignRecipient.update({
                where: { id: recipientId },
                data: { status: 'FAILED', error: !agent ? 'Agent deleted' : 'Instance deleted' }
            });
            return;
        }
        if (!(agent as any).isActive || !agent.provider) return;

        const sock = sessions.get(campaign.instanceId);
        if (!sock) {
            await prisma.campaignRecipient.update({
                where: { id: recipientId },
                data: { status: 'FAILED', error: 'Instance not connected' }
            });
            return;
        }

        // Update status to SENDING
        await prisma.campaignRecipient.update({
            where: { id: recipientId },
            data: { status: 'SENDING' }
        });

        try {
            let text: string;
            let result: any = null;
            const providerInfo = agent.provider;

            if ((campaign as any).mode === 'fixed_template' && (campaign as any).messageTemplate) {
                // Fixed-template path — no LLM call. Interpolate simple
                // {{phone}} / {{name}} variables from the Client row
                // (if we have one for this number).
                const digits = recipient.phone.replace(/[^0-9]/g, '');
                const client = await prisma.client.findFirst({
                    where: { workspaceId: (campaign as any).workspaceId ?? undefined, phone: { contains: digits } },
                    select: { name: true },
                });
                text = String((campaign as any).messageTemplate)
                    .replaceAll('{{phone}}', recipient.phone)
                    .replaceAll('{{name}}', client?.name || 'there');
            } else {
                // AI-composed path — legacy behaviour.
                let aiModel: any;
                if (providerInfo.provider === 'OPENAI') {
                    aiModel = createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
                } else if (providerInfo.provider === 'CLAUDE') {
                    aiModel = createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
                } else if (providerInfo.provider === 'GEMINI') {
                    aiModel = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
                } else {
                    throw new Error(`Unknown provider: ${providerInfo.provider}`);
                }
                const systemPrompt = (agent.systemPrompt || 'You are a helpful assistant.') +
                    '\n\nYou are starting a new conversation. Send your opening message to the contact.';
                result = await generateText({
                    model: aiModel,
                    system: systemPrompt,
                    messages: [{ role: 'user' as const, content: 'Start the conversation.' }],
                } as any);
                void recordUsagePostHoc({
                    workspaceId: (agent as any).workspaceId || null,
                    userId: (agent as any).userId || null,
                    agentId: agent.id,
                    providerInfo,
                    model: agent.model,
                    cause: 'campaign',
                }, result);
                text = result.text;
            }

            if (!text) throw new Error('Empty message body');

            // Send WhatsApp message — media-first when configured, then
            // caption via the same send (Baileys accepts { image, caption }).
            const mediaUrl = (campaign as any).mediaUrl as string | null;
            const mediaType = (campaign as any).mediaType as string | null;
            if (mediaUrl && mediaType) {
                const mediaPayload: any = { caption: text };
                if (mediaType === 'image') mediaPayload.image = { url: mediaUrl };
                else if (mediaType === 'video') mediaPayload.video = { url: mediaUrl };
                else if (mediaType === 'audio') mediaPayload.audio = { url: mediaUrl };
                else if (mediaType === 'document') mediaPayload.document = { url: mediaUrl };
                await sock.sendMessage(recipient.remoteJid, mediaPayload);
            } else {
                await sock.sendMessage(recipient.remoteJid, { text });
            }

            // Save to Message table (so incoming handler has history)
            await prisma.message.create({
                data: {
                    instanceId: campaign.instanceId,
                    remoteJid: recipient.remoteJid,
                    isFromMe: true,
                    messageType: 'text',
                    content: text,
                    timestamp: new Date()
                }
            });

            // Save conversation log (only for AI-composed sends —
            // fixed-template sends don't burn tokens, no log entry needed).
            if (result) {
                await prisma.aiConversationLog.create({
                    data: {
                        agentId: agent.id,
                        instanceId: campaign.instanceId,
                        remoteJid: recipient.remoteJid,
                        userMessage: '[Campaign: First contact]',
                        agentReply: text,
                        promptTokens: result.usage?.inputTokens || 0,
                        completionTokens: result.usage?.outputTokens || 0,
                        totalTokens: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
                        provider: providerInfo.provider,
                        model: agent.model,
                        toolCalls: [],
                    }
                });
            }

            // Mark as sent
            await prisma.campaignRecipient.update({
                where: { id: recipientId },
                data: { status: 'SENT', sentAt: new Date() }
            });

            logger.info(`[Campaign ${campaignId}] Sent to ${recipient.remoteJid}`);

            // Check if campaign is complete
            const pending = await prisma.campaignRecipient.count({
                where: { campaignId, status: { in: ['PENDING', 'SENDING'] } }
            });
            if (pending === 0) {
                await prisma.campaign.update({
                    where: { id: campaignId },
                    data: { status: 'COMPLETED' }
                });
                logger.info(`[Campaign ${campaignId}] Completed`);
            }

        } catch (error: any) {
            logger.error({ err: error }, `[Campaign ${campaignId}] Failed to send to ${recipient.remoteJid}`);
            await prisma.campaignRecipient.update({
                where: { id: recipientId },
                data: { status: 'FAILED', error: error.message }
            });
        }
    }, { connection, concurrency: 1 });

    worker.on('failed', (job, err) => {
        logger.error({ err }, `Campaign job ${job?.id} failed`);
    });

    logger.info('Campaign worker started');
};
