FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
