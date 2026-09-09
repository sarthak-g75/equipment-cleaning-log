import type { Services } from '../../src/container';
import { createAuditService } from '../../src/modules/audit/audit.service';
import { createAuthService } from '../../src/modules/auth/auth.service';
import { createCleaningRecordService } from '../../src/modules/cleaning-records/cleaning-record.service';
import { createEquipmentService } from '../../src/modules/equipment/equipment.service';
import { createUserService } from '../../src/modules/users/user.service';
import { createInMemoryUnitOfWork, type InMemoryUnitOfWork } from './fakes';

/**
 * The real service graph over in-memory repositories.
 *
 * This is the composition root's shape with a different adapter behind it, and
 * it only exists because `createApp()` takes its services as a parameter. While
 * the controllers imported the container directly, the HTTP layer could not be
 * exercised without a live Postgres — the dependency-inversion claim stopped at
 * the service boundary.
 */
export function createFakeServices(): { services: Services; uow: InMemoryUnitOfWork } {
  const uow = createInMemoryUnitOfWork();

  const services: Services = {
    auth: createAuthService(uow),
    users: createUserService(uow),
    equipment: createEquipmentService(uow),
    cleaningRecords: createCleaningRecordService(uow),
    audit: createAuditService(uow),
  };

  return { services, uow };
}
