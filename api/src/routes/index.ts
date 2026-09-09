import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { authRouter } from '../modules/auth/auth.routes';
import { equipmentRouter } from '../modules/equipment/equipment.routes';
import { cleaningRecordRouter } from '../modules/cleaning-records/cleaning-record.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);

// Everything below this line requires a verified token. Applying it here rather
// than per-route means a newly added route is protected by default; forgetting
// to opt in is the failure mode that leaks data.
apiRouter.use(requireAuth);
apiRouter.use('/equipment', equipmentRouter);
apiRouter.use('/cleaning-records', cleaningRecordRouter);
