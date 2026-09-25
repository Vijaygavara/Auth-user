import { isDatabaseHealthy } from '../config/database';
import { isRedisHealthy } from '../config/redis';

export type DependencyStatus = 'connected' | 'disconnected';
export type HealthState = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthReport {
  state: HealthState;
  database: DependencyStatus;
  redis: DependencyStatus;
  uptime: number;
}

const toStatus = (up: boolean): DependencyStatus => (up ? 'connected' : 'disconnected');

/**
 * Health rules:
 *   - PostgreSQL down -> unhealthy: no auth request can be served.
 *   - Redis down      -> degraded: the API keeps serving and rate limiting uses
 *                        its fallback. Reporting this as unhealthy would make
 *                        the load balancer pull every instance at once, turning
 *                        a Redis blip into a full outage.
 *
 * Only coarse statuses are reported; hostnames, versions and error messages
 * stay in the logs, not in the public response.
 */
export async function getHealthReport(): Promise<HealthReport> {
  const [databaseUp, redisUp] = await Promise.all([isDatabaseHealthy(), isRedisHealthy()]);

  let state: HealthState = 'healthy';
  if (!databaseUp) state = 'unhealthy';
  else if (!redisUp) state = 'degraded';

  return {
    state,
    database: toStatus(databaseUp),
    redis: toStatus(redisUp),
    uptime: Number(process.uptime().toFixed(2)),
  };
}
