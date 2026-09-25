import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Request } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger';

const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller-supplied request ID (e.g. from a load balancer) only if it
// looks sane, so clients can't inject arbitrary content into our logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

// pino-http runs inside Express, so the raw request is an Express Request.
// originalUrl survives router mounting; req.ip honours the trust-proxy setting.
const describe = (req: IncomingMessage): string => {
  const expressReq = req as Request;
  return `${expressReq.method} ${expressReq.originalUrl ?? expressReq.url}`;
};

interface SerializedRequest {
  id: string;
  raw: IncomingMessage;
}

/**
 * HTTP access logging. One structured line per completed request, including
 * a request ID that is echoed back in the `X-Request-Id` response header so a
 * client-reported problem can be matched to its log line.
 *
 * Request bodies and headers (Authorization, cookies) are never logged.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: resolveRequestId,
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res, responseTime) =>
    `${describe(req)} ${res.statusCode} ${Math.round(responseTime)}ms`,
  customErrorMessage: (req, res) => `${describe(req)} ${res.statusCode} failed`,
  serializers: {
    req: ({ id, raw }: SerializedRequest) => {
      const expressReq = raw as Request;
      return {
        id,
        method: expressReq.method,
        url: expressReq.originalUrl ?? expressReq.url,
        ip: expressReq.ip,
        userAgent: expressReq.headers['user-agent'],
      };
    },
    res: ({ statusCode }: { statusCode: number }) => ({ statusCode }),
  },
});
