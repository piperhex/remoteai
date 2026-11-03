package devices

import "sync"

// A reservation follows the frame from source staging to the destination writer.
// There is only one owner at a time; moving never reserves account/instance bytes twice.
type bulkReservation struct {
	holder        *peer
	bytes         int64
	globalRelease func()
	once          sync.Once
}

func (p *peer) reserveBulk(owner string, bytes int) *bulkReservation {
	if !p.claimBulkBytes(int64(bytes)) {
		return nil
	}
	release, ok := reserveBulkQueue(owner, bytes)
	if !ok {
		p.bulkBuffered.Add(-int64(bytes))
		return nil
	}
	return &bulkReservation{holder: p, bytes: int64(bytes), globalRelease: release}
}

func (p *peer) claimBulkBytes(bytes int64) bool {
	for {
		used := p.bulkBuffered.Load()
		if used+bytes > bulkConnectionQueue {
			return false
		}
		if p.bulkBuffered.CompareAndSwap(used, used+bytes) {
			return true
		}
	}
}

func (r *bulkReservation) move(target *peer) bool {
	if r.holder == target {
		return true
	}
	if !target.claimBulkBytes(r.bytes) {
		return false
	}
	r.holder.bulkBuffered.Add(-r.bytes)
	r.holder = target
	return true
}

func (r *bulkReservation) release() {
	r.once.Do(func() {
		r.holder.bulkBuffered.Add(-r.bytes)
		r.globalRelease()
	})
}

func (frame outputFrame) releaseBulk() {
	if frame.reservation != nil {
		frame.reservation.release()
	}
}

func (frame outputFrame) cancelled() bool {
	return channelClosed(frame.sourceDone) || channelClosed(frame.sessionDone)
}

func channelClosed(done <-chan struct{}) bool {
	select {
	case <-done:
		return true
	default:
		return false
	}
}

func notifyBulkQueues() {
	bulkQueues.Lock()
	close(bulkQueues.changed)
	bulkQueues.changed = make(chan struct{})
	bulkQueues.Unlock()
}
