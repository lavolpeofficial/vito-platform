FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm prisma:generate
RUN pnpm build


FROM node:22-bookworm-slim AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_HOME="/opt/corepack"
ENV NODE_ENV="production"

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bubblewrap \
      ca-certificates \
      git \
      openssl \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
 && corepack prepare pnpm@11.17.0 --activate \
 && pnpm --version

# Server-owned coding launcher. The exact OpenCode version is pinned so the
# governed executable identity is reproducible. The wrapper and its runtime
# both live beneath the trusted launcher root; callers never resolve from PATH.
#
# The reviewed wrapper pins the server-owned OpenCode model for run invocations
# and emits bounded provider/model identity evidence from the ephemeral SQLite
# session database after execution.
RUN mkdir -p /opt/vito/trusted-launchers/opencode-runtime \
 && npm install --prefix /opt/vito/trusted-launchers/opencode-runtime --omit=dev --no-audit --no-fund @opencode/cli@2.0.3

COPY deploy/staging/trusted-launchers/opencode /opt/vito/trusted-launchers/opencode
COPY deploy/staging/trusted-launchers/opencode-sqlite-identity-evidence.mjs /opt/vito/trusted-launchers/opencode-sqlite-identity-evidence.mjs

RUN chmod 0755 /opt/vito/trusted-launchers/opencode \
 && chmod 0644 /opt/vito/trusted-launchers/opencode-sqlite-identity-evidence.mjs \
 && /opt/vito/trusted-launchers/opencode --version

COPY --from=builder /app /app

EXPOSE 3000 3001

CMD ["pnpm", "start"]

[executed on device: ubuntu-4gb-hel1-1 (fe3754ea-5627-4a36-b351-e958ef584b11)]