FROM rust:1.96.1-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler libprotobuf-dev clang cmake \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
COPY crates/chat-connectivity ./crates/chat-connectivity
RUN cargo build --locked --release --manifest-path crates/chat-connectivity/Cargo.toml --bin chat-rendezvous

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /source/crates/chat-connectivity/target/release/chat-rendezvous /usr/local/bin/chat-rendezvous
COPY --from=builder /source/crates/chat-connectivity/README.md /source/crates/chat-connectivity/LICENSE-EasyTier \
    /usr/share/doc/chat-connectivity/
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/chat-rendezvous"]
