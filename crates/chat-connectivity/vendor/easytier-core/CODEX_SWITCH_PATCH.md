# Codex Switch mixed symmetric NAT fallback

Upstream: <https://github.com/EasyTier/EasyTier/tree/ed73d318bb3bf19601e227ab83dd61d66ce4b9f8/easytier-core>.
This directory retains the upstream LGPL-3.0 license. `Cargo.toml` expands the upstream workspace dependencies;
`easytier-proto` still points to the same Git revision. Existing upstream files and tests are retained to keep the
patch reviewable and upgradable; their pre-existing size/style is not an invitation to refactor unrelated code.

## Behavior

Upstream skips UDP punching between `Symmetric` and `SymmetricEasyInc` / `SymmetricEasyDec`.
`udp/common.rs` now selects `HardSymToEasySym`, with only the hard side initiating. Disabled P2P, disabled symmetric
punching, public-node exclusions, existing direct links, authentication, and session cancellation still apply.
Hard/hard and symmetric UDP firewall combinations remain unsupported by this fallback.

`udp/mixed.rs` rotates through 16 sockets × 256 predicted ports, 8 × 512, and 4 × 1024 on failed attempts.
The wider windows tolerate larger easy-side mapping drift while keeping the same 4,096 mapping budget; the cycle
returns to the focused window to retain socket diversity. It uses the existing authenticated
`select_punch_listener` / `send_punch_packet_hard_sym` RPCs to
ask that side to probe random hard-side ports. The peer's observed packet source and the original punched socket
are retained for the transport handshake. A STUN mapping or receipt of a punch packet alone is never marked direct;
the existing encrypted peer admission and one-hop route checks remain authoritative.

The fallback is probabilistic: a monotonic peer mapping must intersect an existing hard-side mapping. Interleaved
traffic, large mapping strides, IP-dependent exits, finite NAT tables, firewalls, or random mappings on both sides
may defeat it. No universal success rate or parity with another product is claimed.

Each attempt lasts at most 10 seconds and sends at most 12,288 small local probe datagrams (4,096 distinct mappings).
The legacy remote RPC's round-8 budget limits it to at most 200 destinations per pass (rounded up for two public IPs),
two passes, at most two public IPs;
its existing triple-packet sending and pacing are unchanged. Retries wait 1, 10, 30, then 60 seconds, including after
RPC failures. All socket-array tasks and the outbound RPC are canceled with the attempt. Remote RPC work is bounded
by the existing server implementation. Failed native discovery continues to use the existing WebSocket relay.

The peer and coordinator protocols are unchanged. Updating the hard-side native client is sufficient to initiate
this fallback with a compatible old easy-side client. Desktop, its unattended service, Android and iOS use the same
crate; ordinary browsers cannot open these raw UDP sockets and retain WebRTC plus WebSocket relay.

## Structured diagnostics

`udp/diagnostics` adds an instance-owned bounded broadcast stream exposed through
`CoreInstance::udp_punch_diagnostics`. Strategy decisions share the scheduler's eligibility logic;
each outbound UDP attempt records its lifecycle and a fixed error classification. The mixed strategy additionally
measures socket allocation, successful local probe sends, received/matched/rejected packets and handshake failures.
`connector_attempts.rs` separates the existing retry loops from connector lifecycle wiring.

Reports serialize only enums and counters; peer IDs stay internal for host-side session filtering. No candidate
addresses, raw RPC errors or credentials cross the JSON bridge. Hosts subscribe before startup; lag and dropped
bridge reports are counted, and diagnostic producers never wait for a consumer. Missing probe counts on other
UDP strategies must not be interpreted as zero. Transport admission remains distinct from a verified direct route.

## Scope and tests

- `udp/common.rs`, `udp/connector.rs`, `udp/mod.rs`, `udp/task.rs`: strategy selection, scheduling and regression tests.
- `udp/mixed.rs`, `udp/mixed_budget.rs`, `udp/mixed_tests.rs`: bounded probes, rotating prediction windows,
  source validation and deterministic endpoint-dependent NAT emulation, incremental/decremental mappings,
  mapping drift, bidirectional data, deadlines, cancellation, rejection and exhausted attempts.
- Feature guards in `instance/manager.rs`, `instance/tests.rs`, `config/toml.rs`, `process_runtime.rs`, and
  `tunnel/encrypt/mod.rs` allow the retained upstream tests and the minimal native feature set to compile cleanly.
- Atomic flow counters and port allocators use `try_update`, available at the Rust 1.95 minimum version,
  to preserve their behavior without deprecated `fetch_update` warnings on newer toolchains.

Run the hole-punch tests from the parent workspace with `--no-default-features` and
`--features aes-gcm,proxy-smoltcp-stack,tcp-hole-punch`; the native connectivity CI does this on Windows, Linux and macOS.
The simulator validates packet filtering and socket reuse; it is not a real carrier-network success-rate test.
Replace this patch when upstream provides an equivalent bounded mixed-NAT strategy, retaining its regression tests.

## STUN proxy isolation

The shared STUN resolver excludes the `198.18.0.0/15` benchmark range commonly used for proxy Fake-IP DNS,
including IPv4-mapped IPv6 forms. Filtering happens before per-domain sampling and applies to explicit,
DNS and TXT-expanded endpoints. UDP/TCP classification and fallback port mapping use the same resolver,
so a proxy's public egress cannot be introduced through these synthetic destinations.

Configure at least two independent STUN endpoints verified to use the intended direct egress, with a similarly
verified backup. Filtering alone does not provide missing observations: insufficient evidence stays unknown,
and actual multi-egress or symmetric mappings retain their conservative classification. No proxy bypass,
unconditional cone classification or changed P2P admission rule is introduced. Resolver regression tests cover
mixed answers, filtered-only configurations, TXT, mapped IPv6 and preservation of genuine symmetric results.

## Desktop media UDP receive registration

`gateway/dataplane/{udp,flow,packet,mod}.rs` adds `DataPlaneUdpSocket::allow_peer` for the native desktop
media adapter. Existing outbound UDP retains its exact-tuple behavior. An explicitly registered listener accepts
initial packets only for its bound local address/port and one specified virtual peer IP, with RAII cleanup.
This lets a remote WebRTC ICE agent send the first check before the local agent has transmitted to its port.
Packet routing tests cover peer/port isolation and revocation; adapter tests cover a real one-way initial packet.

## STUN Max comparison

Reviewed [uk0/stun_max at adc74688](https://github.com/uk0/stun_max/blob/adc74688ffdcebd0df1d978a52e908c748652d3c/client/core/stun.go).
Its multi-socket probing, wider port prediction and relay retries informed the comparison; no STUN Max source is
included in this patch. Its advertised NAT3/NAT4 success rate does not establish a rate for two symmetric NATs.
In that revision, `attemptHolePunch` sends on auxiliary sockets then closes them, while `udpReadLoop` receives on
the main socket. That does not preserve a successful auxiliary mapping for endpoint-dependent filters. Its drift
model is local, so it is not reliable evidence of the remote NAT's allocation pattern. Our fallback instead keeps
the punched socket and observed remote tuple, validates a normal transport, and uses bounded prediction windows
without pretending to know a remote drift rate. This is not a full port or replacement of STUN Max.
