# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src
COPY prompts ./prompts

# Symlink the Northflank-mounted secret so Sentry CLI can find it
RUN if [ -f /secrets/.sentryclirc ]; \
    then ln -sf /secrets/.sentryclirc ~/.sentryclirc; \
    else echo "Warning: No .sentryclirc found in /secrets"; \
    fi

# Build TypeScript
RUN pnpm run build

# Production stage
FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy prompts directory for runtime access
COPY prompts ./prompts

# Copy instrument.mjs for Sentry initialization
COPY instrument.mjs ./

# Expose port
EXPOSE 3000

# Set NODE_ENV to production
ENV NODE_ENV=production

# Start the application
CMD ["pnpm", "start"]
