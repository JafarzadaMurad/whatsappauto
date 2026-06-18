import { Router } from 'express';
import { CustomTableController } from './customtable.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new CustomTableController();

router.use(authMiddleware);
router.use(requirePerm('tables', 'view'));

router.get('/', controller.getTables.bind(controller));
router.get('/:id', controller.getTable.bind(controller));
router.post('/', requirePerm('tables', 'create'), controller.createTable.bind(controller));
router.put('/:id', requirePerm('tables', 'update'), controller.updateTable.bind(controller));
router.delete('/:id', requirePerm('tables', 'delete'), controller.deleteTable.bind(controller));

router.get('/:tableId/rows', controller.getRows.bind(controller));
router.post('/:tableId/rows', requirePerm('tables', 'create'), controller.createRow.bind(controller));
router.put('/:tableId/rows/:id', requirePerm('tables', 'update'), controller.updateRow.bind(controller));
router.delete('/:tableId/rows/:id', requirePerm('tables', 'delete'), controller.deleteRow.bind(controller));

export default router;
