import { Router } from 'express';
import { CampaignController } from './campaign.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new CampaignController();

router.use(authMiddleware);

router.get('/', controller.getCampaigns.bind(controller));
router.get('/:id', controller.getCampaign.bind(controller));
router.post('/', controller.createCampaign.bind(controller));
router.post('/:id/pause', controller.pauseCampaign.bind(controller));
router.post('/:id/resume', controller.resumeCampaign.bind(controller));
router.delete('/:id', controller.deleteCampaign.bind(controller));

export default router;
