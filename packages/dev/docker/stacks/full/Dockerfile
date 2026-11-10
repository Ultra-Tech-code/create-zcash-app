# Zebra 7.0.0 with indexer feature enabled
# Builds Zebra release binary from upstream tag v7.0.0 (commit e8db87eb69254e0d4eedd058eadd48bdfa09065a)
# with Cargo features: "default-release-binaries,indexer"
FROM rust:1.91.0-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    clang \
    libclang-dev \
    protobuf-compiler \
    ca-certificates \
    git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/zebra
RUN git clone https://github.com/ZcashFoundation/zebra.git . && \
    git checkout e8db87eb69254e0d4eedd058eadd48bdfa09065a && \
    cargo build --release --locked --bin zebrad --features "default-release-binaries,indexer"

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Match Zebra standard non-root user (UID 10001)
RUN addgroup --gid 10001 zebra && \
    adduser --gid 10001 --uid 10001 --home /home/zebra --disabled-password --gecos "" zebra

USER zebra
WORKDIR /home/zebra

COPY --from=builder /usr/src/zebra/target/release/zebrad /usr/local/bin/zebrad

EXPOSE 18232 8230 8080
ENTRYPOINT ["zebrad"]

