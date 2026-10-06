FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        bash \
        ca-certificates \
        coreutils \
        git \
        tar \
        util-linux \
    && rm -rf /var/lib/apt/lists/*
