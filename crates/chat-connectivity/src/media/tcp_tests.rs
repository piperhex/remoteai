use super::*;
use tokio::sync::watch;

#[tokio::test]
async fn preserves_fragmented_stun_and_channel_data_boundaries() {
    let (mut writer, mut reader) = tokio::io::duplex(3);
    let channel = vec![0x40, 1, 0, 3, 9, 8, 7];
    let mut stun = vec![0; 20];
    stun[1] = 1;
    let task = tokio::spawn(async move {
        write_frame(&mut writer, &channel).await.unwrap();
        write_frame(&mut writer, &stun).await.unwrap();
    });
    assert_eq!(
        read_frame(&mut reader).await.unwrap(),
        [0x40, 1, 0, 3, 9, 8, 7]
    );
    assert_eq!(read_frame(&mut reader).await.unwrap().len(), 20);
    task.await.unwrap();
    assert!(frame_size(&[0x80, 0, 0, 0]).is_err());
    assert!(frame_size(&[0, 1, 0, 1]).is_err());
    assert!(write_frame(&mut tokio::io::sink(), &[0x40, 1, 0, 3, 9])
        .await
        .is_err());
}

#[tokio::test]
async fn loopback_bridge_survives_client_close_and_stops_with_grant() {
    let (parent, grant) = watch::channel(false);
    let (_cancel, canceled) = watch::channel(false);
    let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let address = start(
        server.local_addr().unwrap(),
        Lifetime {
            parent: grant,
            canceled,
        },
    )
    .await
    .unwrap();
    assert!(address.ip().is_loopback());
    let packet = [0x40, 1, 0, 3, 9, 8, 7];
    for _ in 0..2 {
        let mut client = TcpStream::connect(address).await.unwrap();
        write_frame(&mut client, &packet).await.unwrap();
        let mut buffer = [0; 32];
        let (length, source) =
            tokio::time::timeout(Duration::from_secs(2), server.recv_from(&mut buffer))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(&buffer[..length], &packet);
        assert!(source.ip().is_loopback());
        server.send_to(&packet, source).await.unwrap();
        assert_eq!(read_frame(&mut client).await.unwrap(), packet);
    }
    let mut client = TcpStream::connect(address).await.unwrap();
    // Revocation must interrupt a partial frame rather than waiting for its idle timeout.
    client.write_all(&[0x40, 1]).await.unwrap();
    parent.send_replace(true);
    let mut buffer = [0; 1];
    let closed = tokio::time::timeout(Duration::from_secs(2), client.read(&mut buffer))
        .await
        .unwrap();
    assert!(matches!(closed, Ok(0) | Err(_)));
    assert!(TcpStream::connect(address).await.is_err());
}
