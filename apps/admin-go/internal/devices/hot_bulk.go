package devices

// Call under chatSessions.mu. A reconnect starts a new endpoint generation, so
// frames authorized for an old pair can never reach the replacement connection.
func (session *hotSession) cancelBulk() {
	if session.bulkDone != nil {
		close(session.bulkDone)
		session.bulkDone = nil
		notifyBulkQueues()
	}
}

func (s *chatSessions) stopBulkSession(delivery relayDelivery) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session := s.hot.sessions[delivery.sessionID]
	if session == nil || session.bulkDone != delivery.sessionDone {
		return
	}
	// Resource pressure affects this session, never the shared desktop transport.
	s.hot.remove(session)
}
