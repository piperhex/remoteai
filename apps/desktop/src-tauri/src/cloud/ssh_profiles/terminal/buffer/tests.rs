use super::*;
use std::sync::Arc;

fn append(buffer: &Buffer, data: &[u8]) {
    assert!(buffer.event(Event::Output {
        data: data.to_vec()
    }));
}

#[tokio::test]
async fn reads_are_replayable_and_waiting_never_terminates_the_process() {
    let buffer = Arc::new(Buffer::default());
    let waiting = buffer.read("one", 0, 10).await.unwrap();
    assert!(waiting.wait_timed_out && !waiting.closed);
    append(&buffer, b"password: ");
    let first = buffer.read("one", 0, 0).await.unwrap();
    assert_eq!(first.output, "password: ");
    assert_eq!(buffer.read("one", 0, 0).await.unwrap().output, first.output);
    let next = buffer.clone();
    let cursor = first.cursor;
    let pending = tokio::spawn(async move { next.read("one", cursor, 1000).await.unwrap() });
    append(&buffer, b"done");
    let result = pending.await.unwrap();
    assert_eq!(result.output, "done");
    assert!(!result.wait_timed_out);
    buffer.event(Event::Exit { code: Some(7) });
    let last = buffer.read("one", result.cursor, 1000).await.unwrap();
    assert!(last.closed);
    assert_eq!(last.exit_code, Some(7));
}

#[tokio::test]
async fn bounded_replay_reports_lost_output_and_pages_utf8_without_splitting_glyphs() {
    let buffer = Buffer::default();
    append(&buffer, &vec![b'x'; BUFFER_BYTES + 9]);
    let first = buffer.read("one", 0, 0).await.unwrap();
    assert!(first.truncated && first.has_more);
    assert_eq!(first.cursor, (9 + READ_BYTES) as u64);
    assert_eq!(first.output.len(), READ_BYTES);
    assert!(buffer.read("one", u64::MAX, 0).await.is_err());
    let unicode = Buffer::default();
    let input = "中".repeat(READ_BYTES);
    append(&unicode, input.as_bytes());
    unicode.event(Event::Exit { code: Some(0) });
    let mut output = String::new();
    let mut cursor = 0;
    loop {
        let page = unicode.read("one", cursor, 0).await.unwrap();
        cursor = page.cursor;
        output.push_str(&page.output);
        if !page.has_more {
            break;
        }
    }
    assert_eq!(output, input);
}

#[tokio::test]
async fn partial_utf8_and_secret_echoes_wait_for_more_bytes_without_leaking() {
    let buffer = Buffer::default();
    buffer.protect(b"saved-password").unwrap();
    append(&buffer, &[0xe4, 0xb8]);
    assert!(buffer.read("one", 0, 10).await.unwrap().output.is_empty());
    append(&buffer, &[0xad]);
    append(&buffer, b"saved-pass");
    assert_eq!(buffer.read("one", 0, 0).await.unwrap().output, "中");
    append(&buffer, b"word\r\n");
    assert_eq!(
        buffer.read("one", 0, 0).await.unwrap().output,
        "中[redacted]\r\n"
    );
    assert!(!buffer.expired(Duration::from_secs(60)));
}
