# Bulk relay isolation

The authenticated WebSocket reader validates and routes messages synchronously, but never waits
for a bulk receiver to free capacity. This covers all CSF1 bulk records, including port mapping;
it does not depend on the file-download policy switch. The binary protocol is unchanged.

## Scheduling and bounds

- An available target accepts a record immediately. When it is full, the source stages records
  and starts at most one dispatcher for that connection. The dispatcher examines independent
  session lanes without waiting on any one target, maintaining directional FIFO within each
  session's bulk stream. Existing control/RPC priority over bulk is preserved.
- Each connection's **256 KiB** budget covers both its staged source records and its destination
  records (including the active socket write). Staging is also capped at **32 records** per source.
  All records share the existing **2 MiB per account** and **32 MiB per instance** budgets.
  A reservation moves from source to destination without releasing/reacquiring the global budget
  or double charging it. There is no unbudgeted waiting record or goroutine per frame.
- This absorbs a normal 16-record burst even when its relay envelopes overflow the destination
  byte cap. A staged record has a five-second deadline, checked at most 50 ms later. Releases,
  new work, and endpoint cancellation wake the dispatcher immediately. Idle dispatchers sleep
  until more work or source closure, and exit when the source closes.
- Admission beyond a hard byte/record budget, or expiration of a staged record, removes **only
  that hot session** and sends the existing `peer-close` event to its endpoints. It does not close
  the shared desktop transport. If an account/instance budget is exhausted, new bulk admissions
  for that budget cannot succeed; signals, authentication and WebSocket control still run.
  Without client stream credits, unlimited lossless buffering and an always-readable multiplexed
  transport cannot both be provided. Sustained overload therefore requires reopening the affected
  session; the server neither silently drops an admitted active stream nor buffers without bounds.

## Authorization, lifetime and accounting

Endpoint membership and ownership are resolved under the session lock before dispatch. An endpoint
generation is cancelled on session removal, disconnect, or either endpoint's replacement/resume.
Staged and queued records carry that generation. Delayed timeout callbacks cannot remove a newer
generation, and cancelled queued records are skipped before billing/writing. In-flight network
writes may already have sent bytes; their existing bounded write deadline and conservative
accounting semantics remain in force. Cancellation racing an accounting grant is never reported
as a successful write; existing accounting retains ambiguous attempted reservations conservatively.

No session/global routing lock is held while waiting for capacity, accounting or network writes.
Accounting still authorizes the destination writer, with the original envelope-inclusive wire
size and success callback. The optional bulk-lease writer retains the same batching/billing policy.

## Regression coverage

`go test ./internal/devices -run TestBulk` covers the production source reader/decode/receive path
over real WebSockets, two sessions on one source, a stopped writer and a real non-reading TCP
receiver, unrelated control/relay/bulk, Ping/Pong and authentication rejection, FIFO bursts,
all queue budgets, timeout, disconnect, resume/re-register and stale callbacks. Cancellation and
wire-byte accounting tests exercise both ordinary guarded writes and the optional lease writer.
Tests wait for dispatcher shutdown and assert queue reservations are returned.

Also run the complete devices/chattraffic/mediarelay/server regressions, `TestKong`, and a Go race
build when changing this scheduler. Database/Redis and production capacity tests are separate from
the deterministic relay tests and must not be described as covered when their opt-in tests skip.
