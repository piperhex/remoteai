use std::io::{Read, Write};

use super::*;

fn connection() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    // CI delays loopback packets, so wait for the server-side handshake before accepting.
    let (server, _) = listener.accept().unwrap();
    // Reproduce Windows inheritance on every test platform.
    server.set_nonblocking(true).unwrap();
    configure_stream(&server).unwrap();
    (client, server)
}

#[test]
fn idle_connections_wait_for_the_read_timeout_instead_of_spinning() {
    let (_client, mut server) = connection();
    let timeout = Duration::from_millis(100);
    server.set_read_timeout(Some(timeout)).unwrap();
    let started = Instant::now();
    let error = server.read(&mut [0]).unwrap_err();
    assert!(matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    ));
    assert!(started.elapsed() >= timeout / 2);
}

#[test]
fn a_frame_can_arrive_in_separate_tcp_reads() {
    let (mut client, mut server) = connection();
    let message = serde_json::json!({"type":"session", "sessionId":"idle"});
    let bytes = serde_json::to_vec(&message).unwrap();
    thread::scope(|scope| {
        let reading = scope.spawn(|| {
            transport::read_frame::<serde_json::Value>(&mut server, transport::MAX_REQUEST_BYTES)
        });
        client
            .write_all(&(bytes.len() as u32).to_le_bytes())
            .unwrap();
        thread::sleep(Duration::from_millis(30));
        client.write_all(&bytes[..2]).unwrap();
        thread::sleep(Duration::from_millis(30));
        client.write_all(&bytes[2..]).unwrap();
        assert_eq!(reading.join().unwrap().unwrap(), Some(message));
    });
}
