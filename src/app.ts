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
import campaignRoutes from './modules/campaign/campaign.routes';
import instagramRoutes from './modules/instagram/instagram.routes';

const app: Express = express();

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
});
app.use(limiter);

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
app.use('/api/campaigns', campaignRoutes);
app.use('/api/instagram', instagramRoutes);

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
