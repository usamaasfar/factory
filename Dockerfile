FROM oven/bun:1.4.2 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY sdk/package.json ./sdk/package.json
RUN bun install --frozen-lockfile

COPY src ./src
COPY sdk/src ./sdk/src
COPY integrations ./integrations
COPY sandboxes ./sandboxes
COPY drizzle.config.ts ./
# State is disposable for now; generate the schema for this engine build.
RUN bun run db:generate && bun prune --production

FROM oven/bun:1.4.2
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
LABEL org.opencontainers.image.source="https://github.com/usamaasfar/factory"

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/sdk ./sdk
COPY --from=build /app/src ./src
COPY --from=build /app/integrations ./integrations
COPY --from=build /app/sandboxes ./sandboxes
COPY --from=build /app/drizzle ./drizzle

# Users mount their own configuration here; repository workflows are not bundled.
RUN mkdir -p .factory/workflows
USER bun
EXPOSE 8080
CMD ["bun", "src/index.ts"]
