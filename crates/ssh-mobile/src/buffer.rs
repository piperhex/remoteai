use csw_ssh_client::Event;
use serde::Serialize;
use std::collections::VecDeque;

const MAX_BUFFER_BYTES: usize = 1024 * 1024;
const MAX_EVENTS: usize = 2048;
const OUTPUT_CHUNK: usize = 16 * 1024;
const READ_BYTES: usize = 64 * 1024;

#[derive(Default)]
pub(crate) struct Buffer {
    events: VecDeque<(u64, Event)>,
    cursor: u64,
    bytes: usize,
    pub(crate) exited: bool,
    lease: Option<String>,
    acknowledged: u64,
}

#[derive(Serialize)]
pub(crate) struct Read {
    pub found: bool,
    pub events: Vec<Event>,
    pub cursor: u64,
    pub truncated: bool,
}

fn weight(event: &Event) -> usize {
    match event {
        Event::Output { data } => data.len(),
        Event::Error { message } => message.len(),
        Event::Exit { .. } => 0,
    }
}

impl Buffer {
    pub(crate) fn binary_mode(
        &mut self,
        token: &str,
        enabled: bool,
    ) -> csw_ssh_client::Result<bool> {
        if token.is_empty() || token.len() > 128 {
            return Err(csw_ssh_client::Error::Invalid);
        }
        if enabled {
            self.lease = Some(token.to_owned());
            self.acknowledged = self.cursor;
            return Ok(true);
        }
        if self.lease.as_deref() != Some(token) {
            return Ok(false);
        }
        self.lease = None;
        Ok(true)
    }

    pub(crate) fn acknowledge(&mut self, cursor: u64, token: Option<&str>) -> usize {
        if self.lease.is_none() || self.lease.as_deref() != token {
            return 0;
        }
        let bytes = self
            .events
            .iter()
            .filter(|(at, _)| *at > self.acknowledged && *at <= cursor)
            .map(|(_, event)| weight(event))
            .sum::<usize>();
        self.acknowledged = self.acknowledged.max(cursor.min(self.cursor));
        bytes.min(csw_ssh_client::MAX_INPUT_BYTES)
    }

    pub(crate) fn push(&mut self, event: Event) {
        if let Event::Output { data } = event {
            for chunk in data.chunks(OUTPUT_CHUNK) {
                self.append(Event::Output {
                    data: chunk.to_vec(),
                });
            }
        } else {
            self.exited |= matches!(event, Event::Exit { .. });
            self.append(event);
        }
    }

    fn append(&mut self, event: Event) {
        self.cursor += 1;
        self.bytes += weight(&event);
        self.events.push_back((self.cursor, event));
        while self.bytes > MAX_BUFFER_BYTES || self.events.len() > MAX_EVENTS {
            if let Some((_, event)) = self.events.pop_front() {
                self.bytes -= weight(&event);
            }
        }
    }

    pub(crate) fn read(&self, after: u64) -> Read {
        let oldest = self
            .events
            .front()
            .map_or(self.cursor, |(cursor, _)| cursor - 1);
        let mut reply = Read {
            found: true,
            events: Vec::new(),
            cursor: after.max(oldest).min(self.cursor),
            truncated: after < oldest || after > self.cursor,
        };
        let mut bytes = 0;
        for (cursor, event) in &self.events {
            if *cursor <= after {
                continue;
            }
            if bytes + weight(event) > READ_BYTES {
                break;
            }
            bytes += weight(event);
            reply.cursor = *cursor;
            reply.events.push(event.clone());
        }
        reply
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_credit_requires_the_current_reader_and_is_not_replayed() {
        let mut buffer = Buffer::default();
        buffer.push(Event::Output { data: vec![1; 10] });
        assert!(buffer.binary_mode("reader", true).unwrap());
        buffer.push(Event::Output { data: vec![2; 20] });
        assert_eq!(buffer.acknowledge(2, Some("other")), 0);
        assert_eq!(buffer.acknowledge(2, Some("reader")), 20);
        assert_eq!(buffer.acknowledge(2, Some("reader")), 0);
        assert!(!buffer.binary_mode("old-reader", false).unwrap());
        assert!(buffer.binary_mode("reader", false).unwrap());
        buffer.push(Event::Output { data: vec![3; 30] });
        assert_eq!(buffer.acknowledge(3, Some("reader")), 0);
    }

    #[test]
    fn bounded_replay_reports_loss_and_preserves_exit() {
        let mut buffer = Buffer::default();
        buffer.push(Event::Output {
            data: vec![42; MAX_BUFFER_BYTES * 2],
        });
        buffer.push(Event::Exit { code: Some(0) });
        let mut reply = buffer.read(0);
        assert!(reply.truncated);
        assert!(buffer.bytes <= MAX_BUFFER_BYTES);
        let mut data = Vec::new();
        loop {
            for event in reply.events {
                if let Event::Output { data: chunk } = event {
                    data.extend(chunk);
                }
            }
            reply = buffer.read(reply.cursor);
            if reply.events.is_empty() {
                break;
            }
        }
        assert_eq!(data, vec![42; MAX_BUFFER_BYTES]);
        assert!(buffer.exited);
    }
}
