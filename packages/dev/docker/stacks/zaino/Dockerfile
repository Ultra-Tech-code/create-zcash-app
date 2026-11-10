# Zaino feat/nu7 experimental Dockerfile
# Pins commit aaf8122a703704e05147d984f08ff82c789860ad (Rust 1.96.0 toolchain required)
#
# NOTE: This Zaino build uses the `no_tls_use_unencrypted_traffic` feature; gRPC is plain-text.
# This stack is REGTEST ONLY, bound to 127.0.0.1 on the host. Never expose it or use it for testnet/mainnet.
# RPC backend (works against a remote Zebra RPC; direct state-reader mode is not offered in this stack).
FROM rust:1.96.0-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    clang \
    libclang-dev \
    protobuf-compiler \
    ca-certificates \
    git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/zaino
RUN git clone https://github.com/zingolabs/zaino.git . && \
    git checkout aaf8122a703704e05147d984f08ff82c789860ad && \
    cargo build --release -p zainod --features no_tls_use_unencrypted_traffic

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl netcat-openbsd && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/src/zaino/target/release/zainod /usr/local/bin/zainod

EXPOSE 8137
ENTRYPOINT ["zainod"]
CMD ["start", "-c", "/etc/zaino/zainod.toml"]

