import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { listUsersQuerySchema } from './user.validation';
import { listUsersHandler } from './user.controller';

export const userRouter = Router();

userRouter.get('/', validate({ query: listUsersQuerySchema }), listUsersHandler);
