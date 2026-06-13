import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

const store = new Map<string, { count: number; resetAt: number }>();

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = c.req.header("x-forwarded-for") ?? "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const max = 60;

  const entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count++;
    if (entry.count > max) {
      throw new HTTPException(429, { message: "Too many requests" });
    }
  }

  await next();
};
