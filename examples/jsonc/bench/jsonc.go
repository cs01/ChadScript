package main

import (
	"fmt"
	"os"
)

var input []byte
var pos, length int

var out []byte

func outChar(c byte) {
	out = append(out, c)
}

func outSlice(s []byte) {
	out = append(out, s...)
}

func outString(s string) {
	out = append(out, s...)
}

func skipWS() {
	for pos < length {
		c := input[pos]
		if c == ' ' || c == '\n' || c == '\r' || c == '\t' {
			pos++
		} else if c == '/' && pos+1 < length && input[pos+1] == '/' {
			pos += 2
			for pos < length && input[pos] != '\n' {
				pos++
			}
			if pos < length {
				pos++
			}
		} else if c == '/' && pos+1 < length && input[pos+1] == '*' {
			pos += 2
			for pos+1 < length && !(input[pos] == '*' && input[pos+1] == '/') {
				pos++
			}
			pos += 2
		} else {
			return
		}
	}
}

func parseString() {
	outChar('"')
	pos++
	for pos < length {
		c := input[pos]
		if c == '\\' {
			outChar('\\')
			pos++
			if pos < length {
				outChar(input[pos])
				pos++
			}
		} else if c == '"' {
			outChar('"')
			pos++
			return
		} else {
			outChar(c)
			pos++
		}
	}
}

func parseNumber() {
	start := pos
	if pos < length && input[pos] == '-' {
		pos++
	}
	for pos < length && input[pos] >= '0' && input[pos] <= '9' {
		pos++
	}
	if pos < length && input[pos] == '.' {
		pos++
		for pos < length && input[pos] >= '0' && input[pos] <= '9' {
			pos++
		}
	}
	if pos < length && (input[pos] == 'e' || input[pos] == 'E') {
		pos++
		if pos < length && (input[pos] == '+' || input[pos] == '-') {
			pos++
		}
		for pos < length && input[pos] >= '0' && input[pos] <= '9' {
			pos++
		}
	}
	outSlice(input[start:pos])
}

func parseObject() {
	pos++
	outChar('{')
	skipWS()
	first := true
	for pos < length && input[pos] != '}' {
		if !first {
			outChar(',')
		}
		first = false
		skipWS()
		if pos < length && input[pos] == '}' {
			break
		}
		parseString()
		skipWS()
		if pos < length && input[pos] == ':' {
			pos++
		}
		outChar(':')
		skipWS()
		parseValue()
		skipWS()
		if pos < length && input[pos] == ',' {
			pos++
			skipWS()
		}
	}
	if pos < length {
		pos++
	}
	outChar('}')
}

func parseArray() {
	pos++
	outChar('[')
	skipWS()
	first := true
	for pos < length && input[pos] != ']' {
		if !first {
			outChar(',')
		}
		first = false
		skipWS()
		if pos < length && input[pos] == ']' {
			break
		}
		parseValue()
		skipWS()
		if pos < length && input[pos] == ',' {
			pos++
			skipWS()
		}
	}
	if pos < length {
		pos++
	}
	outChar(']')
}

func parseValue() {
	skipWS()
	if pos >= length {
		return
	}
	c := input[pos]
	switch {
	case c == '"':
		parseString()
	case c == '{':
		parseObject()
	case c == '[':
		parseArray()
	case c == '-' || (c >= '0' && c <= '9'):
		parseNumber()
	case c == 't':
		outString("true")
		pos += 4
	case c == 'f':
		outString("false")
		pos += 5
	case c == 'n':
		outString("null")
		pos += 4
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: jsonc <file>")
		os.Exit(1)
	}
	var err error
	input, err = os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	length = len(input)
	pos = 0
	out = make([]byte, 0, length)

	parseValue()
	out = append(out, '\n')
	os.Stdout.Write(out)
}
