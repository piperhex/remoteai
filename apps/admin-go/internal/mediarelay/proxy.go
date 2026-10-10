package mediarelay

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"sync"
	"time"
)

const idleTimeout = 2 * time.Minute
const connectTimeout = 5 * time.Second
const maxConnections = 1024
const maxConnectionsPerIP = 32

type Config struct {
	Listen, Backend, Realm, Secret string
	TLSListen, TLSCert, TLSKey     string
	TLSCertURL                     string
}

// Proxy exposes coturn only through metered listeners. Its backend must never be publicly reachable.
type Proxy struct {
	config       Config
	transmit     Transmit
	backend      *net.UDPAddr
	udp          net.PacketConn
	tcp, tls     net.Listener
	mu           sync.Mutex
	closed       bool
	connections  map[string]*connection
	workers      sync.WaitGroup
	context      context.Context
	cancel       context.CancelFunc
	certificates *certificates
	udpBudget    udpBudget
}

type connection struct {
	gate     gate
	backend  net.Conn
	client   net.Conn
	upload   *udpQueue
	download *udpQueue
	done     chan struct{}
	ip       string
	once     sync.Once
}

func Start(config Config, transmit Transmit) (*Proxy, error) {
	if len(config.Secret) < 32 || config.Realm == "" || config.Backend == "" || transmit == nil {
		return nil, errors.New("invalid media relay configuration")
	}
	p := &Proxy{config: config, transmit: transmit, connections: map[string]*connection{}}
	p.context, p.cancel = context.WithCancel(context.Background())
	backend, err := net.ResolveUDPAddr("udp", config.Backend)
	if err != nil {
		return nil, err
	}
	p.backend = backend
	if err := p.listen(); err != nil {
		p.Close()
		return nil, err
	}
	p.workers.Add(2)
	go p.readUDP()
	go p.accept(p.tcp)
	if p.tls != nil {
		p.workers.Add(1)
		go p.accept(p.tls)
		p.workers.Add(1)
		go p.refreshCertificates(p.certificates)
	}
	return p, nil
}

func (p *Proxy) listen() error {
	var err error
	// Select the TCP port first: Windows can reserve TCP ranges independently of UDP.
	p.tcp, err = net.Listen("tcp", p.config.Listen)
	if err != nil {
		return err
	}
	p.udp, err = net.ListenPacket("udp", p.tcp.Addr().String())
	if err != nil {
		return err
	}
	if p.config.TLSListen == "" {
		return nil
	}
	p.certificates = &certificates{config: p.config}
	if err := p.certificates.refresh(p.context); err != nil {
		return err
	}
	p.tls, err = tls.Listen("tcp", p.config.TLSListen, &tls.Config{
		MinVersion: tls.VersionTLS12, GetCertificate: p.certificates.get,
	})
	return err
}

func (p *Proxy) allowed(ip string) bool {
	if p.closed || len(p.connections) >= maxConnections {
		return false
	}
	count := 0
	for _, connection := range p.connections {
		if connection.ip == ip {
			count++
		}
	}
	return count < maxConnectionsPerIP
}

func (p *Proxy) remove(key string, c *connection) {
	c.once.Do(func() {
		close(c.done)
		if c.upload != nil {
			c.upload.close()
			c.download.close()
		}
		// Closing an already failed socket is intentional during cleanup.
		_ = c.backend.Close()
		if c.client != nil {
			_ = c.client.Close()
		}
		p.mu.Lock()
		if p.connections[key] == c {
			delete(p.connections, key)
		}
		p.mu.Unlock()
	})
}

func (p *Proxy) Close() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.closed = true
	connections := make(map[string]*connection, len(p.connections))
	for key, c := range p.connections {
		connections[key] = c
	}
	p.mu.Unlock()
	if p.cancel != nil {
		p.cancel()
	}
	// Listener/socket close errors are expected when shutdown races a network failure.
	if p.udp != nil {
		_ = p.udp.Close()
	}
	if p.tcp != nil {
		_ = p.tcp.Close()
	}
	if p.tls != nil {
		_ = p.tls.Close()
	}
	for key, c := range connections {
		p.remove(key, c)
	}
	p.workers.Wait()
}
