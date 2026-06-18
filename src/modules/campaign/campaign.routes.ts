import { Router } from 'express';
import { CampaignController } from './campaign.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new CampaignController();

router.use(authMiddleware);
router.use(requirePerm('campaigns', 'view'));

router.get('/', controller.getCampaigns.bind(controller));
router.get('/:id', controller.getCampaign.bind(controller));
router.post('/', requirePerm('campaigns', 'create'), controller.createCampaign.bind(controller));
router.post('/:id/pause', requirePerm('campaigns', 'update'), controller.pauseCampaign.bind(controller));
router.post('/:id/resume', requirePerm('campaigns', 'update'), controller.resumeCampaign.bind(controller));
router.delete('/:id', requirePerm('campaigns', 'delete'), controller.deleteCampaign.bind(controller));

export default router;
