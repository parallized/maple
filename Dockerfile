FROM oven/bun:1.3.14 AS build
WORKDIR /src
COPY package.json bun.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN bun install --frozen-lockfile
RUN cd packages/kanban-core && bun run build \
  && cd ../agent-runtime && bun run build \
  && cd ../worker-skills && bun run build
RUN bun apps/server/scripts/build.ts

FROM oven/bun:1.3.14-debian
WORKDIR /app
ENV NODE_ENV=production \
    MAPLE_HOST=0.0.0.0 \
    MAPLE_PORT=45820 \
    MAPLE_DATA_DIR=/data \
    MAPLE_WEB_ROOT=/app/web
COPY --from=build /src/apps/server/dist/ /app/
VOLUME ["/data"]
EXPOSE 45820
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:45820/health');if(!r.ok)process.exit(1)"]
CMD ["bun", "/app/index.js"]
