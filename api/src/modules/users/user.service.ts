import type { UnitOfWork, UserSummary } from '../../shared/ports';
import type { ListUsersQuery } from './user.validation';

export interface UserService {
  list(query: ListUsersQuery): Promise<UserSummary[]>;
}

export function createUserService(uow: UnitOfWork): UserService {
  return {
    list: (query) => uow.repos.users.list({ role: query.role, q: query.q, limit: query.limit }),
  };
}
