//! Bounded raw IPC for relay downloads. File bytes never enter the JSON chat bridge.
use std::collections::VecDeque;

use tauri::ipc::{Channel, Response};

use super::{bulk, protocol::ChatError};

const MAX_FRAME_BYTES: usize = 16 * 1024 + 5 + 128;
const MAX_BUFFER_BYTES: usize = 4 * 1024 * 1024;
const MAX_QUEUED_RECORDS: usize = 256;
const MAX_BATCH_RECORDS: usize = 16;
const BATCH_HEADER_BYTES: usize = 9;

pub(super) struct ClientBulk {
    channel: Option<Channel<Response>>,
    enabled: bool,
    queue: VecDeque<Vec<u8>>,
    buffered: usize,
    sequence: u32,
    pending: usize,
}

impl ClientBulk {
    pub fn new(channel: Option<Channel<Response>>) -> Self {
        Self {
            channel,
            enabled: false,
            queue: VecDeque::new(),
            buffered: 0,
            sequence: 0,
            pending: 0,
        }
    }

    pub fn negotiate(&mut self, enabled: bool) {
        self.enabled = enabled && self.channel.is_some();
    }

    /// Leave room for one maximum record before reading another socket frame.
    pub fn has_capacity(&self) -> bool {
        self.buffered <= MAX_BUFFER_BYTES - MAX_FRAME_BYTES && self.queue.len() < MAX_QUEUED_RECORDS
    }

    pub fn enqueue(&mut self, bytes: Vec<u8>, session: Option<&str>) -> Result<(), ChatError> {
        if !self.enabled || session != Some(bulk::session_id(&bytes)?.as_str()) {
            return Err(ChatError::InvalidFrame);
        }
        if self.buffered + bytes.len() > MAX_BUFFER_BYTES || self.queue.len() >= MAX_QUEUED_RECORDS
        {
            return Err(ChatError::Transport);
        }
        self.buffered += bytes.len();
        self.queue.push_back(bytes);
        Ok(())
    }

    pub fn acknowledge(&mut self, sequence: u64) {
        if sequence == u64::from(self.sequence) {
            self.buffered -= self.pending;
            self.pending = 0;
        }
    }

    /// A single acknowledged batch bounds callbacks even while the renderer is suspended.
    pub fn flush(&mut self) -> Result<(), ChatError> {
        if self.pending != 0 || self.queue.is_empty() {
            return Ok(());
        }
        let channel = self.channel.as_ref().ok_or(ChatError::Transport)?;
        self.sequence = self.sequence.checked_add(1).ok_or(ChatError::Transport)?;
        let count = self.queue.len().min(MAX_BATCH_RECORDS);
        let length: usize = self.queue.iter().take(count).map(Vec::len).sum();
        let mut batch = Vec::with_capacity(BATCH_HEADER_BYTES + count * 4 + length);
        batch.extend_from_slice(b"CGR1");
        batch.extend_from_slice(&self.sequence.to_be_bytes());
        batch.push(count as u8);
        for frame in self.queue.drain(..count) {
            batch.extend_from_slice(&(frame.len() as u32).to_be_bytes());
            batch.extend_from_slice(&frame);
        }
        self.pending = length;
        channel
            .send(Response::new(batch))
            .map_err(|_| ChatError::Transport)
    }
}

#[cfg(test)]
#[path = "client_bulk_tests.rs"]
mod tests;
