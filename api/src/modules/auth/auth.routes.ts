import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { loginBodySchema } from './auth.validation';
import { loginHandler, meHandler } from './auth.controller';

export const authRouter = Router();

authRouter.post('/login', validate({ body: loginBodySchema }), loginHandler);
authRouter.get('/me', requireAuth, meHandler);
