package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
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
	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, err = conn.Write([]byte(req))
	if err != nil {
		conn.Close()
		return nil, err
	}

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
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

	conn.SetReadDeadline(time.Time{})
	conn.SetWriteDeadline(time.Time{})
	return conn, nil
}

func wsSendText(conn net.Conn, frame []byte) error {
	_, err := conn.Write(frame)
	return err
}

func buildFrame(data []byte, maskKey [4]byte) []byte {
	payloadLen := len(data)
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
	header = append(header, maskKey[:]...)

	masked := make([]byte, payloadLen)
	for i := 0; i < payloadLen; i++ {
		masked[i] = data[i] ^ maskKey[i%4]
	}

	return append(header, masked...)
}

func wsReadFrame(conn net.Conn, buf []byte) (int, error) {
	_, err := io.ReadFull(conn, buf[:2])
	if err != nil {
		return 0, err
	}

	payloadLen := int(buf[1] & 0x7F)
	if payloadLen == 126 {
		_, err := io.ReadFull(conn, buf[:2])
		if err != nil {
			return 0, err
		}
		payloadLen = int(binary.BigEndian.Uint16(buf[:2]))
	} else if payloadLen == 127 {
		_, err := io.ReadFull(conn, buf[:8])
		if err != nil {
			return 0, err
		}
		payloadLen = int(binary.BigEndian.Uint64(buf[:8]))
	}

	if payloadLen > len(buf) {
		buf = make([]byte, payloadLen)
	}

	_, err = io.ReadFull(conn, buf[:payloadLen])
	if err != nil {
		return 0, err
	}

	return payloadLen, nil
}

func main() {
	serverURL := flag.String("url", "ws://127.0.0.1:9877/", "WebSocket server URL")
	numClients := flag.Int("c", 32, "number of concurrent clients")
	dur := flag.Duration("d", 10*time.Second, "test duration")
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

	var done int64
	var wg sync.WaitGroup

	conns := make([]net.Conn, *numClients)

	fmt.Printf("Connecting %d WebSocket clients to %s...\n", *numClients, u.String())

	connected := 0
	for i := 0; i < *numClients; i++ {
		c, err := wsConnect(host)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  client %d: %v\n", i, err)
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

	msg := []byte("Hello, World!")
	maskKey := [4]byte{0x12, 0x34, 0x56, 0x78}
	frame := buildFrame(msg, maskKey)

	counters := make([]int64, *numClients)

	for i := 0; i < *numClients; i++ {
		if conns[i] == nil {
			continue
		}
		wg.Add(1)
		go func(idx int, c net.Conn) {
			defer wg.Done()
			readBuf := make([]byte, 4096)
			for atomic.LoadInt64(&done) == 0 {
				err := wsSendText(c, frame)
				if err != nil {
					return
				}
				_, err = wsReadFrame(c, readBuf)
				if err != nil {
					return
				}
				atomic.AddInt64(&counters[idx], 1)
			}
		}(i, conns[i])
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)

	fmt.Printf("Running for %s...\n\n", *dur)

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	start := time.Now()
	var lastTotal int64

loop:
	for {
		select {
		case <-ticker.C:
			var cur int64
			for i := 0; i < *numClients; i++ {
				cur += atomic.LoadInt64(&counters[i])
			}
			delta := cur - lastTotal
			lastTotal = cur
			elapsed := time.Since(start).Seconds()
			fmt.Printf("  [%.0fs] %d echo/sec\n", elapsed, delta)
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
	var totalEchoes int64
	for i := 0; i < *numClients; i++ {
		totalEchoes += counters[i]
	}
	rps := float64(totalEchoes) / elapsed.Seconds()

	fmt.Println()
	fmt.Printf("Clients:     %d\n", connected)
	fmt.Printf("Duration:    %.2fs\n", elapsed.Seconds())
	fmt.Printf("Echoes:      %d\n", totalEchoes)
	fmt.Printf("Echo/sec:    %.0f\n", rps)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
