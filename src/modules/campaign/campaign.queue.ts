import { Queue, Worker } from 'bullmq';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { sessions } from '../whatsapp/instance.manager';
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
        if (campaign.status !== 'RUNNING') return;

        const agent = campaign.agent;
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
            // Configure AI model
            const providerInfo = agent.provider;
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

            // Generate first message
            const systemPrompt = (agent.systemPrompt || 'You are a helpful assistant.') +
                '\n\nYou are starting a new conversation. Send your opening message to the contact.';

            const result = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages: [{ role: 'user' as const, content: 'Start the conversation.' }],
            } as any);

            const text = result.text;
            if (!text) throw new Error('AI returned empty response');

            // Send WhatsApp message
            await sock.sendMessage(recipient.remoteJid, { text });

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

            // Save conversation log
            await prisma.aiConversationLog.create({
                data: {
                    agentId: agent.id,
                    instanceId: campaign.instanceId,
                    remoteJid: recipient.remoteJid,
                    userMessage: '[Campaign: First contact]',
                    agentReply: text,
                    promptTokens: (result as any).usage?.inputTokens || 0,
                    completionTokens: (result as any).usage?.outputTokens || 0,
                    totalTokens: ((result as any).usage?.inputTokens || 0) + ((result as any).usage?.outputTokens || 0),
                    provider: providerInfo.provider,
                    model: agent.model,
                    toolCalls: [],
                }
            });

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
