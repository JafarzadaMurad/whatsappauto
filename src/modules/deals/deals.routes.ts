import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
    listPipelines, createPipeline, updatePipeline, deletePipeline,
    createStage, updateStage, reorderStages, deleteStage,
    listDeals, createDeal, updateDeal, moveDeals, deleteDeal,
} from './deals.controller';

const router = Router();

router.use(authMiddleware);

// Pipelines
router.get('/pipelines',       listPipelines);
router.post('/pipelines',      createPipeline);
router.patch('/pipelines/:id', updatePipeline);
router.delete('/pipelines/:id', deletePipeline);

// Stages
router.post('/pipelines/:pipelineId/stages',                  createStage);
router.put('/pipelines/:pipelineId/stages/reorder',           reorderStages);
router.patch('/pipelines/:pipelineId/stages/:stageId',        updateStage);
router.delete('/pipelines/:pipelineId/stages/:stageId',       deleteStage);

// Deals
router.get('/deals',            listDeals);
router.post('/deals',           createDeal);
router.put('/deals/move',       moveDeals);
router.patch('/deals/:id',      updateDeal);
router.delete('/deals/:id',     deleteDeal);

export default router;
