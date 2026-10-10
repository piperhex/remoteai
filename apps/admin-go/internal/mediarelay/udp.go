package mediarelay

import (
	"context"
	"net"
	"time"
)

func (p *Proxy) readUDP() {
	defer p.workers.Done()
	buffer := make([]byte, maxFrameBytes)
	for {
		n, address, err := p.udp.ReadFrom(buffer)
		if err != nil {
			return
		}
		if _, _, err = decode(buffer[:n]); err != nil {
			continue
		}
		c := p.udpConnection(address)
		if c == nil {
			continue
		}
		// A full queue drops this datagram, but never stalls other clients or grows without bounds.
		c.upload.push(buffer[:n])
	}
}

func (p *Proxy) udpConnection(address net.Addr) *connection {
	key := "udp:" + address.String()
	ip, _, err := net.SplitHostPort(address.String())
	if err != nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if c := p.connections[key]; c != nil {
		return c
	}
	if !p.allowed(ip) {
		return nil
	}
	// UDP dial creates a local socket; backend DNS is resolved once at configuration time.
	backend, err := net.DialUDP("udp", nil, p.backend)
	if err != nil {
		return nil
	}
	c := &connection{backend: backend, upload: newUDPQueue(&p.udpBudget),
		download: newUDPQueue(&p.udpBudget), done: make(chan struct{}), ip: ip}
	p.connections[key] = c
	p.workers.Add(3)
	go p.forwardUDP(key, c, nil)
	go p.forwardUDP(key, c, address)
	go p.receiveUDP(key, c)
	return c
}

func (p *Proxy) forwardUDP(key string, c *connection, address net.Addr) {
	defer p.workers.Done()
	defer p.remove(key, c)
	queue := c.upload
	if address != nil {
		queue = c.download
	}
	for {
		packet := queue.pop(c.done)
		if packet == nil {
			return
		}
		err := p.forward(&c.gate, packet, address == nil, func() error {
			select {
			case <-c.done:
				return context.Canceled
			default:
			}
			if address != nil {
				_, err := p.udp.WriteTo(packet, address)
				return err
			}
			if err := c.backend.SetWriteDeadline(time.Now().Add(connectTimeout)); err != nil {
				return err
			}
			return writeFrame(c.backend, packet)
		})
		queue.release(len(packet))
		if err != nil {
			return
		}
	}
}

func (p *Proxy) receiveUDP(key string, c *connection) {
	defer p.workers.Done()
	defer p.remove(key, c)
	buffer := make([]byte, maxFrameBytes)
	for {
		if err := c.backend.SetReadDeadline(time.Now().Add(idleTimeout)); err != nil {
			return
		}
		n, err := c.backend.Read(buffer)
		if err != nil {
			return
		}
		// Keep draining the backend while quota checks are in flight for earlier packets.
		c.download.push(buffer[:n])
	}
}
