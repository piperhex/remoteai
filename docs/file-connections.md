# Independent file connections

Current desktop, Web and Native clients negotiate file connections independently of chat.
Small file control requests (open, manifest, block credit and cancel) remain authenticated chat RPCs;
encrypted file records use the binary transport. Local desktop downloads retain their local backend.

## P2P

Authenticated ping/pong frames advertise `fileConnectionV1`. When both peers support it, they open a
separate WebRTC peer with its own ICE generations, keepalive and file DataChannel. SDP and ICE messages
carry `lane: "file"`; they are never applied to the chat peer. Closing/retrying the file peer does not
change chat's selected path. The file transport selects its own available P2P or Relay path, so its path
can differ from chat. A direct-file path change fences transfer epochs; verified download checkpoints
remain available for resume. Older peers retain their existing binary channels.

## Relay

The coordinator issues an endpoint-specific `fileRelay` capability in `peer-open`, `paired` and `resumed`.
Clients connect to the existing `/device-chat` route with `?channel=file` and send
`file-relay-authenticate` containing only the session ID and capability. The socket accepts CSF1 file
records for that session, never chat RPCs. Files retain end-to-end encryption and account quota metering.

Each source reader waits for the bounded destination queue. This applies TCP backpressure on the file
socket while the chat reader remains available. Once negotiated, peers never fall back into their chat socket when
the file socket is unavailable. Legacy peers can still receive their existing binary relay format.
Legacy file queue exhaustion fences file records and emits `file-relay-reset`, preserving the chat session.
Main-session recovery or revocation closes its file sockets and invalidates the previous capabilities.

Desktop file sockets use Rust's existing cloud endpoint and system proxy dialer, separate cancellation,
bounded raw IPC batches and acknowledgements. Android's dedicated socket delivers records directly to
the native download engine; Web and iOS use the shared browser-compatible adapter. Android native module
changes require a rebuilt application. Updating only Web cannot update installed desktop or Native code.

## Verification

`apps/admin/internal/devices/file_relay_test.go` exercises capabilities, revocation, legacy compatibility,
queue limits, successful-byte billing and an 8 MiB slow transfer while chat continues. Desktop's
`e2e/file-connection.pw.ts` transfers encrypted records through real Chromium WebRTC peers and a separate
WebSocket, and verifies chat survives closing the file peers. Rust tests cover capability-only
authentication and raw IPC. Native tests cover separate socket negotiation and failure isolation.
