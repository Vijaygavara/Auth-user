import { isIPv4, isIPv6 } from 'node:net';
import type { Request } from 'express';

/**
 * The client identity used for per-IP rate limiting.
 *
 * `req.ip` already honours the `trust proxy` setting: it is the TCP peer when
 * no proxy is trusted, or the right-most untrusted X-Forwarded-For entry when
 * one is. Arbitrary client-supplied headers are never read directly.
 *
 * Normalization:
 *   - IPv4-mapped IPv6 ("::ffff:203.0.113.9") -> "203.0.113.9", so one client
 *     can't get two buckets depending on the socket's address family.
 *   - IPv6 is bucketed by /64. A single customer is usually assigned a whole
 *     /64 (18 quintillion addresses), so per-address limits would be trivial
 *     to evade by rotating addresses.
 */
export function getClientIp(req: Request): string {
  const raw = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return normalizeIp(raw);
}

export function normalizeIp(raw: string): string {
  const ip = raw.split('%')[0] ?? raw; // drop IPv6 zone id ("fe80::1%eth0")

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];

  if (isIPv4(ip) || ip === '::1') return ip; // loopback is a single host: keep it readable
  if (isIPv6(ip)) return `${ipv6Prefix64(ip)}::/64`;
  return ip;
}

/** First four 16-bit groups of an IPv6 address, zero-expanded ("2001:db8:0:1"). */
function ipv6Prefix64(ip: string): string {
  const [head = '', tail] = ip.toLowerCase().split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];

  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}
