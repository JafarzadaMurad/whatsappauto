import { Router } from 'express';
import { CustomTableController } from './customtable.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new CustomTableController();

router.use(authMiddleware);

// Table routes
router.get('/', controller.getTables.bind(controller));
router.get('/:id', controller.getTable.bind(controller));
router.post('/', controller.createTable.bind(controller));
router.put('/:id', controller.updateTable.bind(controller));
router.delete('/:id', controller.deleteTable.bind(controller));

// Row routes
router.get('/:tableId/rows', controller.getRows.bind(controller));
router.post('/:tableId/rows', controller.createRow.bind(controller));
router.put('/:tableId/rows/:id', controller.updateRow.bind(controller));
router.delete('/:tableId/rows/:id', controller.deleteRow.bind(controller));

export default router;
