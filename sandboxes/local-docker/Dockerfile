FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash coreutils util-linux \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
ENTRYPOINT ["/usr/bin/sleep"]
CMD ["infinity"]
