package turnquota

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/mediarelay"
)

func unusedAddress(t *testing.T) string {
	t.Helper()
	for attempt := 0; attempt < 50; attempt++ {
		if address := availableAddress(); address != "" {
			return address
		}
	}
	t.Fatal("no shared TCP/UDP loopback port available")
	return ""
}

func availableAddress() string {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return ""
	}
	defer listener.Close()
	address := listener.Addr().String()
	udp, err := net.ListenPacket("udp", address)
	if err != nil {
		return ""
	}
	udp.Close()
	return address
}

func testCertificate(t *testing.T) (string, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	certPath, keyPath := filepath.Join(directory, "cert.pem"), filepath.Join(directory, "key.pem")
	for name, block := range map[string]*pem.Block{certPath: {Type: "CERTIFICATE", Bytes: der},
		keyPath: {Type: "EC PRIVATE KEY", Bytes: keyDER}} {
		if err := os.WriteFile(name, pem.EncodeToMemory(block), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return certPath, keyPath
}

func startMeteredProxy(t *testing.T) [2]string {
	t.Helper()
	addresses := [2]string{unusedAddress(t), unusedAddress(t)}
	cert, key := testCertificate(t)
	proxy, err := mediarelay.Start(mediarelay.Config{Listen: addresses[0], TLSListen: addresses[1],
		Backend: os.Getenv("TURN_QUOTA_TEST_BACKEND"), Realm: "codex-switch", Secret: testSecret,
		TLSCert: cert, TLSKey: key}, func(_ context.Context, _ string, _ int, write func() error) error {
		return write()
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { proxy.Close() })
	return addresses
}
