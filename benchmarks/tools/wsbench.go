package main

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"math/big"
	mrand "math/rand"
	"net"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func wsConnect(host string) (net.Conn, error) {
	conn, err := net.DialTimeout("tcp", host, 5*time.Second)
	if err != nil {
		return nil, err
	}

	keyBytes := make([]byte, 16)
	rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)

	req := fmt.Sprintf("GET / HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", host, key)
	_, err = conn.Write([]byte(req))
	if err != nil {
		conn.Close()
		return nil, err
	}

	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		conn.Close()
		return nil, err
	}
	resp := string(buf[:n])
	if !strings.Contains(resp, "101") {
		conn.Close()
		return nil, fmt.Errorf("upgrade failed: %s", resp[:min(len(resp), 80)])
	}

	magic := "258EAFA5-E914-47DA-95CA-5AB9CD86F85B"
	h := sha1.New()
	h.Write([]byte(key + magic))
	expected := base64.StdEncoding.EncodeToString(h.Sum(nil))
	if !strings.Contains(resp, expected) {
		conn.Close()
		return nil, fmt.Errorf("bad accept key")
	}

	return conn, nil
}

func wsSendText(conn net.Conn, data []byte) error {
	payloadLen := len(data)
	maskKey := make([]byte, 4)
	mrand.Read(maskKey)

	var header []byte
	header = append(header, 0x81)
	if payloadLen < 126 {
		header = append(header, byte(payloadLen)|0x80)
	} else if payloadLen < 65536 {
		header = append(header, 126|0x80)
		lenBytes := make([]byte, 2)
		binary.BigEndian.PutUint16(lenBytes, uint16(payloadLen))
		header = append(header, lenBytes...)
	} else {
		header = append(header, 127|0x80)
		lenBytes := make([]byte, 8)
		binary.BigEndian.PutUint64(lenBytes, uint64(payloadLen))
		header = append(header, lenBytes...)
	}
	header = append(header, maskKey...)

	masked := make([]byte, payloadLen)
	for i := 0; i < payloadLen; i++ {
		masked[i] = data[i] ^ maskKey[i%4]
	}

	frame := append(header, masked...)
	_, err := conn.Write(frame)
	return err
}

func wsReadFrame(conn net.Conn, buf []byte) ([]byte, error) {
	_, err := io.ReadFull(conn, buf[:2])
	if err != nil {
		return nil, err
	}

	payloadLen := int(buf[1] & 0x7F)
	if payloadLen == 126 {
		_, err := io.ReadFull(conn, buf[:2])
		if err != nil {
			return nil, err
		}
		payloadLen = int(binary.BigEndian.Uint16(buf[:2]))
	} else if payloadLen == 127 {
		_, err := io.ReadFull(conn, buf[:8])
		if err != nil {
			return nil, err
		}
		payloadLen = int(binary.BigEndian.Uint64(buf[:8]))
	}

	if payloadLen > len(buf) {
		buf = make([]byte, payloadLen)
	}

	_, err = io.ReadFull(conn, buf[:payloadLen])
	if err != nil {
		return nil, err
	}

	return buf[:payloadLen], nil
}

func main() {
	serverURL := flag.String("url", "ws://127.0.0.1:9877/", "WebSocket server URL")
	numClients := flag.Int("c", 32, "number of concurrent clients")
	dur := flag.Duration("d", 10*time.Second, "test duration")
	msgInterval := flag.Duration("i", 50*time.Millisecond, "interval between sends per client")
	flag.Parse()

	u, err := url.Parse(*serverURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid URL: %v\n", err)
		os.Exit(1)
	}

	host := u.Host
	if !strings.Contains(host, ":") {
		host += ":80"
	}

	var totalReceived int64
	var totalSent int64
	var done int64

	conns := make([]net.Conn, *numClients)
	var wg sync.WaitGroup

	fmt.Printf("Connecting %d WebSocket clients to %s...\n", *numClients, u.String())

	connected := 0
	for i := 0; i < *numClients; i++ {
		c, err := wsConnect(host)
		if err != nil {
			continue
		}
		conns[i] = c
		connected++
	}

	fmt.Printf("Connected: %d/%d\n", connected, *numClients)
	if connected == 0 {
		fmt.Fprintln(os.Stderr, "no clients connected")
		os.Exit(1)
	}

	for i := 0; i < *numClients; i++ {
		if conns[i] == nil {
			continue
		}
		wg.Add(1)
		go func(c net.Conn) {
			defer wg.Done()
			buf := make([]byte, 4096)
			for atomic.LoadInt64(&done) == 0 {
				_, err := wsReadFrame(c, buf)
				if err != nil {
					return
				}
				atomic.AddInt64(&totalReceived, 1)
			}
		}(conns[i])
	}

	for i := 0; i < *numClients; i++ {
		if conns[i] == nil {
			continue
		}
		wg.Add(1)
		go func(c net.Conn) {
			defer wg.Done()
			msg := []byte("Hello, World!")
			for atomic.LoadInt64(&done) == 0 {
				err := wsSendText(c, msg)
				if err != nil {
					return
				}
				atomic.AddInt64(&totalSent, 1)
				time.Sleep(*msgInterval)
			}
		}(conns[i])
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)

	fmt.Printf("Running for %s...\n\n", *dur)

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	start := time.Now()
	var lastReceived int64

	seed, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	mrand.Seed(seed.Int64())

loop:
	for {
		select {
		case <-ticker.C:
			cur := atomic.LoadInt64(&totalReceived)
			delta := cur - lastReceived
			lastReceived = cur
			elapsed := time.Since(start).Seconds()
			fmt.Printf("  [%.0fs] %d msg/sec\n", elapsed, delta)
			if time.Since(start) >= *dur {
				break loop
			}
		case <-sigCh:
			break loop
		}
	}

	atomic.StoreInt64(&done, 1)
	for _, c := range conns {
		if c != nil {
			c.Close()
		}
	}
	wg.Wait()

	elapsed := time.Since(start)
	recv := atomic.LoadInt64(&totalReceived)
	sent := atomic.LoadInt64(&totalSent)
	rps := float64(recv) / elapsed.Seconds()

	fmt.Println()
	fmt.Printf("Clients:     %d\n", connected)
	fmt.Printf("Duration:    %.2fs\n", elapsed.Seconds())
	fmt.Printf("Sent:        %d\n", sent)
	fmt.Printf("Received:    %d\n", recv)
	fmt.Printf("Msg/sec:     %.0f\n", rps)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
