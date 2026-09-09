import { prisma } from './database/prisma';
import { PrismaUnitOfWork } from './database/prisma-repositories';
import { createAuditService } from './modules/audit/audit.service';
import { createAuthService } from './modules/auth/auth.service';
import { createCleaningRecordService } from './modules/cleaning-records/cleaning-record.service';
import { createEquipmentService } from './modules/equipment/equipment.service';
import { createUserService } from './modules/users/user.service';

/**
 * The composition root: the single place that knows which concrete adapters
 * back the ports. Everything else depends on interfaces.
 *
 * Wired by hand rather than with a DI container — with one implementation per
 * port, a container would add a layer of indirection and a dependency without
 * removing any coupling. If a second adapter ever appears, this file is the
 * only one that changes.
 */
export const unitOfWork = new PrismaUnitOfWork(prisma);

export const services = {
  auth: createAuthService(unitOfWork),
  users: createUserService(unitOfWork),
  equipment: createEquipmentService(unitOfWork),
  cleaningRecords: createCleaningRecordService(unitOfWork),
  audit: createAuditService(unitOfWork),
} as const;

export type Services = typeof services;
