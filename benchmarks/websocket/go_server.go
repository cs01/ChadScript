package main

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strings"
)

func handleConn(conn net.Conn) {
	defer conn.Close()

	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return
	}

	req := string(buf[:n])
	keyStart := strings.Index(req, "Sec-WebSocket-Key: ")
	if keyStart == -1 {
		return
	}
	keyStart += len("Sec-WebSocket-Key: ")
	keyEnd := strings.Index(req[keyStart:], "\r\n")
	if keyEnd == -1 {
		return
	}
	key := req[keyStart : keyStart+keyEnd]

	magic := "258EAFA5-E914-47DA-95CA-5AB5DCBE11D5"
	h := sha1.New()
	h.Write([]byte(key + magic))
	accept := base64.StdEncoding.EncodeToString(h.Sum(nil))

	resp := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"
	conn.Write([]byte(resp))

	for {
		_, err := io.ReadFull(conn, buf[:2])
		if err != nil {
			return
		}

		masked := (buf[1] & 0x80) != 0
		payloadLen := int(buf[1] & 0x7F)

		if payloadLen == 126 {
			_, err := io.ReadFull(conn, buf[:2])
			if err != nil {
				return
			}
			payloadLen = int(binary.BigEndian.Uint16(buf[:2]))
		} else if payloadLen == 127 {
			_, err := io.ReadFull(conn, buf[:8])
			if err != nil {
				return
			}
			payloadLen = int(binary.BigEndian.Uint64(buf[:8]))
		}

		var maskKey [4]byte
		if masked {
			_, err := io.ReadFull(conn, maskKey[:])
			if err != nil {
				return
			}
		}

		payload := buf[:payloadLen]
		if payloadLen > len(buf) {
			payload = make([]byte, payloadLen)
		}
		_, err = io.ReadFull(conn, payload[:payloadLen])
		if err != nil {
			return
		}

		if masked {
			for i := 0; i < payloadLen; i++ {
				payload[i] ^= maskKey[i%4]
			}
		}

		var header []byte
		header = append(header, 0x81)
		if payloadLen < 126 {
			header = append(header, byte(payloadLen))
		} else if payloadLen < 65536 {
			header = append(header, 126)
			lenBytes := make([]byte, 2)
			binary.BigEndian.PutUint16(lenBytes, uint16(payloadLen))
			header = append(header, lenBytes...)
		} else {
			header = append(header, 127)
			lenBytes := make([]byte, 8)
			binary.BigEndian.PutUint64(lenBytes, uint64(payloadLen))
			header = append(header, lenBytes...)
		}

		conn.Write(header)
		conn.Write(payload[:payloadLen])
	}
}

func main() {
	ln, err := net.Listen("tcp", ":9877")
	if err != nil {
		fmt.Printf("listen error: %v\n", err)
		return
	}
	fmt.Println("Go WS listening on 9877")
	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}
		go handleConn(conn)
	}
}
