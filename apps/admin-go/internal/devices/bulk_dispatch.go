package devices

import "time"

const bulkPendingFrames = 32
const bulkDispatchInterval = 50 * time.Millisecond

type bulkDispatchItem struct {
	frame    outputFrame
	delivery relayDelivery
	fail     func()
	deadline time.Time
}

// One worker per congested source connection, independent of its socket reader.
// Only bulk waits here; authentication, signals and heartbeats retain their reader.
// bulkDispatchMu protects the pending list and worker creation, never network I/O.
type bulkDispatch struct {
	pending []bulkDispatchItem
	wake    chan struct{}
	stopped chan struct{}
}

func (p *peer) dispatchBulk(item bulkDispatchItem) {
	p.bulkDispatchMu.Lock()
	ok := p.enqueueBulk(item)
	p.bulkDispatchMu.Unlock()
	if !ok {
		item.fail()
	}
}

func (p *peer) enqueueBulk(item bulkDispatchItem) bool {
	if p.closed.Load() || item.frame.cancelled() {
		return true
	}
	if !p.bulkPending(item.delivery.sessionDone) && item.delivery.target.trySendBulk(item.frame, item.delivery.owner) {
		return true
	}
	if p.bulkDispatch != nil && len(p.bulkDispatch.pending) >= bulkPendingFrames {
		return false
	}
	item.frame.reservation = p.reserveBulk(item.delivery.owner, len(item.frame.bytes))
	if item.frame.reservation == nil {
		return false
	}
	item.deadline = time.Now().Add(bulkQueueWaitTimeout)
	if p.bulkDispatch == nil {
		p.bulkDispatch = &bulkDispatch{wake: make(chan struct{}, 1), stopped: make(chan struct{})}
		go p.runBulkDispatch(p.bulkDispatch)
	}
	p.bulkDispatch.pending = append(p.bulkDispatch.pending, item)
	select {
	case p.bulkDispatch.wake <- struct{}{}:
	default:
	}
	return true
}

func (p *peer) bulkPending(session <-chan struct{}) bool {
	if p.bulkDispatch != nil {
		for _, item := range p.bulkDispatch.pending {
			if item.delivery.sessionDone == session {
				return true
			}
		}
	}
	return false
}

func (p *peer) runBulkDispatch(dispatch *bulkDispatch) {
	defer close(dispatch.stopped)
	// Timeouts need no per-frame timers or goroutines. Releases/closure wake immediately.
	timer := time.NewTimer(bulkDispatchInterval)
	defer timer.Stop()
	for {
		p.bulkDispatchMu.Lock()
		idle := len(dispatch.pending) == 0
		p.bulkDispatchMu.Unlock()
		if idle {
			timer.Stop()
			select {
			case <-p.done:
				return
			case <-dispatch.wake:
			}
		}
		bulkQueues.Lock()
		changed := bulkQueues.changed
		bulkQueues.Unlock()
		timer.Reset(bulkDispatchInterval)
		p.flushBulkDispatch(dispatch)
		select {
		case <-p.done:
			p.flushBulkDispatch(dispatch)
			return
		case <-dispatch.wake:
		case <-changed:
		case <-timer.C:
		}
	}
}

func (p *peer) flushBulkDispatch(dispatch *bulkDispatch) {
	p.bulkDispatchMu.Lock()
	blocked := map[<-chan struct{}]bool{}
	var failures []func()
	remaining := dispatch.pending[:0]
	for _, item := range dispatch.pending {
		if p.closed.Load() || item.frame.cancelled() || item.delivery.target.closed.Load() {
			item.frame.releaseBulk()
			continue
		}
		if !blocked[item.delivery.sessionDone] {
			if time.Now().After(item.deadline) {
				item.frame.releaseBulk()
				failures = append(failures, item.fail)
				blocked[item.delivery.sessionDone] = true
				continue
			}
			if item.delivery.target.trySendBulk(item.frame, item.delivery.owner) {
				continue
			}
		}
		blocked[item.delivery.sessionDone] = true
		remaining = append(remaining, item)
	}
	clear(dispatch.pending[len(remaining):])
	dispatch.pending = remaining
	p.bulkDispatchMu.Unlock()
	// Session cancellation takes the routing lock only after releasing the scheduler lock.
	for _, fail := range failures {
		fail()
	}
}
