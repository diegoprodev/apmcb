FROM oven/bun:1.2-alpine AS base
WORKDIR /app

RUN apk add --no-cache curl && \
    addgroup -g 1001 bff && adduser -u 1001 -G bff -s /bin/sh -D bff && \
    chown -R bff:bff /app

# Install dependencies (as root so package cache works, then chown)
COPY --chown=bff:bff package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Copy source
COPY --chown=bff:bff src/ ./src/
COPY --chown=bff:bff tsconfig.json ./

USER bff

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3001/health || exit 1

CMD ["bun", "run", "src/index.ts"]
