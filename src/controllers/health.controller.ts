import type { Request, Response } from 'express';
import { getHealthReport, type HealthState } from '../services/health.service';

const MESSAGES: Record<HealthState, string> = {
  healthy: 'API is healthy',
  degraded: 'API is running in degraded mode',
  unhealthy: 'API is unhealthy',
};

/**
 * GET /api/v1/health
 * 200 while the API can serve requests (healthy or degraded), 503 when it
 * can't, so load balancers and orchestrators (Docker, Kubernetes, ECS) take
 * only genuinely broken instances out of rotation.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  const { state, ...data } = await getHealthReport();
  const canServe = state !== 'unhealthy';

  res.status(canServe ? 200 : 503).json({
    success: canServe,
    message: MESSAGES[state],
    data,
  });
}
