# Zaino feat/nu7 experimental Dockerfile
# Pins commit aaf8122a703704e05147d984f08ff82c789860ad (Rust 1.96.0 toolchain required)
FROM rust:1.96.0-bookworm AS builder

WORKDIR /usr/src/zaino
RUN git clone https://github.com/zingolabs/zaino.git . && \
    git checkout aaf8122a703704e05147d984f08ff82c789860ad && \
    cargo build --release -p zainod

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl netcat-openbsd && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/src/zaino/target/release/zainod /usr/local/bin/zainod

EXPOSE 8137
ENTRYPOINT ["zainod"]
CMD ["start", "-c", "/etc/zaino/zainod.toml"]

