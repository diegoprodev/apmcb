FROM oven/bun:1.2-alpine AS base
WORKDIR /app

RUN apk add --no-cache curl

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3001/health || exit 1

CMD ["bun", "run", "src/index.ts"]
