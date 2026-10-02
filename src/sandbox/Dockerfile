FROM debian:bookworm-slim

COPY .factory/environments/base.linux /tmp/base.linux
RUN chmod +x /tmp/base.linux && /tmp/base.linux && rm /tmp/base.linux

WORKDIR /opt/factory
COPY src/sandbox/protocol.ts src/sandbox/server.ts ./

RUN mkdir /workspace
ENV FACTORY_WORKSPACE=/workspace
WORKDIR /workspace

ENTRYPOINT ["bun", "run", "/opt/factory/server.ts"]
