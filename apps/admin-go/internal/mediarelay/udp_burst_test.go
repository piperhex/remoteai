package mediarelay

import (
	"context"
	"encoding/binary"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const keyframePackets = 256
const keyframePacketBytes = 1200

type udpFixture struct {
	proxy           *Proxy
	backend, client *net.UDPConn
	relay           *net.UDPAddr
}

func openUDPFixture(t *testing.T, transmit Transmit) udpFixture {
	t.Helper()
	backend, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() }) // Socket cleanup may race proxy shutdown.
	config := testConfig
	// Windows reserves UDP ephemeral ranges independently from TCP.
	config.Listen, config.Backend = "127.0.0.1:3489", backend.LocalAddr().String()
	proxy, err := Start(config, transmit)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(proxy.Close)
	client, err := net.DialUDP("udp", nil, proxy.udp.LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	for _, socket := range []*net.UDPConn{backend, client} {
		if err := socket.SetReadBuffer(2 * 1024 * 1024); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := client.Write(authFrame(t, Issue(config.Secret, testOwner, time.Now().Add(time.Minute)))); err != nil {
		t.Fatal(err)
	}
	if err := backend.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	_, relay, err := backend.ReadFromUDP(make([]byte, maxFrameBytes))
	if err != nil {
		t.Fatal(err)
	}
	return udpFixture{proxy, backend, client, relay}
}

func keyframePacket(index int) []byte {
	frame := make([]byte, keyframePacketBytes)
	frame[0], frame[1] = 0x40, 1
	binary.BigEndian.PutUint16(frame[2:4], uint16(len(frame)-channelHeaderBytes))
	binary.BigEndian.PutUint16(frame[4:6], uint16(index))
	return frame
}

func sendKeyframe(t *testing.T, send func([]byte) (int, error), entered <-chan struct{}) {
	t.Helper()
	for i := range keyframePackets {
		if _, err := send(keyframePacket(i)); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("accounting did not start")
			}
		}
		// Exercise buffering during accounting, rather than benchmark the OS under a socket flood.
		time.Sleep(time.Millisecond)
	}
}

func receiveKeyframe(t *testing.T, socket *net.UDPConn) {
	t.Helper()
	if err := socket.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, maxFrameBytes)
	for i := range keyframePackets {
		n, err := socket.Read(buffer)
		if err != nil {
			t.Fatalf("keyframe lost after %d/%d packets: %v", i, keyframePackets, err)
		}
		if n != keyframePacketBytes || int(binary.BigEndian.Uint16(buffer[4:6])) != i {
			t.Fatalf("keyframe packet %d missing or reordered", i)
		}
	}
}

// A keyframe arrives as a burst. Accounting must not stop draining either UDP socket.
func TestUDPKeyframeSurvivesAnAccountingPause(t *testing.T) {
	for _, direction := range []string{"upload", "download"} {
		t.Run(direction, func(t *testing.T) {
			entered, resume := make(chan struct{}), make(chan struct{})
			var pause, release sync.Once
			var billed atomic.Int64
			fixture := openUDPFixture(t, func(ctx context.Context, owner string, size int, write func() error) error {
				if owner != testOwner || size != keyframePacketBytes {
					t.Error("unexpected accounting owner or size")
				}
				pause.Do(func() { close(entered) })
				select {
				case <-resume:
					billed.Add(int64(size))
					return write()
				case <-ctx.Done():
					return ctx.Err()
				}
			})
			unblock := func() { release.Do(func() { close(resume) }) }
			t.Cleanup(unblock)
			send, target := fixture.client.Write, fixture.backend
			if direction == "download" {
				send = func(frame []byte) (int, error) { return fixture.backend.WriteToUDP(frame, fixture.relay) }
				target = fixture.client
			}
			sendKeyframe(t, send, entered)
			unblock()
			receiveKeyframe(t, target)
			fixture.proxy.Close()
			if billed.Load() != keyframePackets*keyframePacketBytes || fixture.proxy.udpBudget.bytes != 0 {
				t.Fatal("packet accounting or shutdown cleanup failed")
			}
		})
	}
}
