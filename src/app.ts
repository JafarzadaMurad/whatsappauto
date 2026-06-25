import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import authRoutes from './modules/auth/auth.routes';
import whatsappRoutes from './modules/whatsapp/whatsapp.routes';
import messagingRoutes from './modules/messaging/messaging.routes';
import webhookRoutes from './modules/webhook/webhook.routes';
import apikeyRoutes from './modules/apikey/apikey.routes';
import aiProviderRoutes from './modules/aiprovider/aiprovider.routes';
import customTableRoutes from './modules/customtable/customtable.routes';
import clientRoutes from './modules/client/client.routes';
import agentRoutes from './modules/agent/agent.routes';
import operatorRoutes from './modules/operator/operator.routes';
import directiveRoutes from './modules/directive/directive.routes';
import adRoutes from './modules/ads/ad.routes';
import metaRoutes from './modules/meta/meta.routes';
import oversightRoutes from './modules/oversight/oversight.routes';
import campaignRoutes from './modules/campaign/campaign.routes';
import instagramRoutes from './modules/instagram/instagram.routes';
import automationRoutes from './modules/automation/automation.routes';
import inboxRoutes from './modules/inbox/inbox.routes';
import planRoutes from './modules/plan/plan.routes';
import adminRoutes from './modules/admin/admin.routes';
import billingRoutes from './modules/billing/billing.routes';
import uploadsRoutes from './modules/uploads/uploads.routes';
import mcpRoutes from './modules/mcp/mcp.routes';
import userFieldRoutes from './modules/userfield/userfield.routes';
import workspaceRoutes from './modules/workspace/workspace.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import { BillingController } from './modules/billing/billing.controller';

const app: Express = express();
app.set('trust proxy', 1);

// Security Middlewares
app.use(helmet());
app.use(
    cors({
        origin: config.FRONTEND_URL,
        credentials: true,
    })
);

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    validate: { trustProxy: false, xForwardedForHeader: false },
});
app.use(limiter);

// Stripe webhook — MUST receive the raw body for signature verification,
// so register it BEFORE the global JSON parser.
const billingController = new BillingController();
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingController.webhook.bind(billingController));

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/instances', whatsappRoutes);
app.use('/api/messages', messagingRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/keys', apikeyRoutes);
app.use('/api/ai-providers', aiProviderRoutes);
app.use('/api/tables', customTableRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/operators', operatorRoutes);
app.use('/api/directives', directiveRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/oversight', oversightRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/user-fields', userFieldRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health Check
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'OK', environment: config.NODE_ENV });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error',
    });
});

export default app;
