// Pure-ChadScript Postgres wire-protocol driver.
//
// Client w/ trust auth + simple 'Q' protocol + text-mode rows. Helpers
// inlined at each use-site because chadscript codegen mishandles
// Uint8Array parameters (silently drops the buffer). See pg-perry-port
// session notes / MEMORY.md.

import { createConnection, Socket } from "chadscript/net";

// SCRAM-SHA-256 helpers implemented in c_bridges/scram-bridge.c (OpenSSL).
// cs_scram_client_final packs two strings joined by \x01 (SOH):
// "<client-final-message>\x01<server-signature-b64>".
declare function cs_scram_random_nonce_b64(): string;
declare function cs_scram_client_first_bare(user: string, nonce: string): string;
declare function cs_scram_client_final(
  password: string,
  clientFirstBare: string,
  serverFirst: string,
): string;
declare function cs_scram_verify_server_final(serverFinal: string, expectedSigB64: string): number;

const RX_CAP = 65536;
const TX_CAP = 65536;

export interface ClientOpts {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string; // empty string when using trust auth
}

export interface QueryResult {
  fields: string[];
  rows: string[][];
  rowCount: number;
  command: string;
}

// ASCII frame-type constants. Keep in sync with pg wire protocol.
const T_ROW_DESC: number = 84; // 'T'
const T_DATA_ROW: number = 68; // 'D'
const T_CMD_DONE: number = 67; // 'C'
const T_READY: number = 90; // 'Z'
const T_ERROR: number = 69; // 'E'
const T_AUTH: number = 82; // 'R' AuthenticationRequest
const T_PARSE_COMPLETE: number = 49; // '1'
const T_BIND_COMPLETE: number = 50; // '2'
const T_NO_DATA: number = 110; // 'n'

// Auth sub-type codes (first 4 bytes of AuthenticationRequest body)
const AUTH_OK: number = 0;
const AUTH_CLEARTEXT: number = 3;
const AUTH_MD5: number = 5;
const AUTH_SASL: number = 10;
const AUTH_SASL_CONTINUE: number = 11;
const AUTH_SASL_FINAL: number = 12;

export class Client {
  private opts: ClientOpts;
  private sock: Socket;
  private rx: Uint8Array;
  private rxLen: number;
  private tmp: Uint8Array;
  private tx: Uint8Array;
  private connected: number;
  private _lastError: string;
  private _frameLen: number;
  private _framePayloadOff: number;
  private _framePayloadEnd: number;

  constructor(opts: ClientOpts) {
    this.opts = opts;
    this.sock = new Socket("");
    this.rx = new Uint8Array(RX_CAP);
    this.rxLen = 0;
    this.tmp = new Uint8Array(RX_CAP);
    this.tx = new Uint8Array(TX_CAP);
    this.connected = 0;
    this._lastError = "";
    this._frameLen = 0;
    this._framePayloadOff = 0;
    this._framePayloadEnd = 0;
  }

  lastError(): string {
    return this._lastError;
  }

  connect(): boolean {
    const s = createConnection(this.opts.host, this.opts.port);
    s.wait(2000);
    if (!s.isOpen()) {
      this._lastError = "tcp connect failed";
      return false;
    }
    this.sock = s;

    // Build StartupMessage inline.
    const u = this.opts.user;
    const d = this.opts.database;
    const uLen = u.length;
    const dLen = d.length;
    const bodyLen = 4 + 5 + (uLen + 1) + 9 + (dLen + 1) + 1;
    const total = 4 + bodyLen;
    const tx = this.tx;
    tx[0] = (total >> 24) & 0xff;
    tx[1] = (total >> 16) & 0xff;
    tx[2] = (total >> 8) & 0xff;
    tx[3] = total & 0xff;
    tx[4] = 0;
    tx[5] = 3;
    tx[6] = 0;
    tx[7] = 0;
    let off = 8;
    // "user\0"
    tx[off] = 117; // 'u'
    tx[off + 1] = 115; // 's'
    tx[off + 2] = 101; // 'e'
    tx[off + 3] = 114; // 'r'
    tx[off + 4] = 0;
    off = off + 5;
    let k = 0;
    while (k < uLen) {
      tx[off + k] = u.charCodeAt(k) & 0xff;
      k = k + 1;
    }
    tx[off + uLen] = 0;
    off = off + uLen + 1;
    // "database\0"
    tx[off] = 100; // 'd'
    tx[off + 1] = 97; // 'a'
    tx[off + 2] = 116; // 't'
    tx[off + 3] = 97; // 'a'
    tx[off + 4] = 98; // 'b'
    tx[off + 5] = 97; // 'a'
    tx[off + 6] = 115; // 's'
    tx[off + 7] = 101; // 'e'
    tx[off + 8] = 0;
    off = off + 9;
    k = 0;
    while (k < dLen) {
      tx[off + k] = d.charCodeAt(k) & 0xff;
      k = k + 1;
    }
    tx[off + dLen] = 0;
    off = off + dLen + 1;
    tx[off] = 0;
    s.writeBytes(tx, total);

    // Drain until Z or E; handle auth request in-between.
    const deadline = Date.now() + 15000;
    while (true) {
      const t = this._pumpOneFrame(deadline);
      if (t === 0) {
        this._lastError = "connect timeout / closed";
        return false;
      }
      if (t === T_AUTH) {
        // Inspect first 4 bytes of body to determine auth sub-type.
        const rx = this.rx;
        const po = this._framePayloadOff;
        const sub = (rx[po] << 24) | (rx[po + 1] << 16) | (rx[po + 2] << 8) | rx[po + 3];
        if (sub === AUTH_OK) {
          this._consumeCurrentFrame();
          // continue loop — server will send S/K frames then Z
        } else if (sub === AUTH_CLEARTEXT) {
          this._sendCleartextPassword();
          this._consumeCurrentFrame();
        } else if (sub === AUTH_MD5) {
          this._sendMd5Password();
          this._consumeCurrentFrame();
        } else if (sub === AUTH_SASL) {
          if (!this._doScram(deadline)) {
            return false;
          }
          continue;
        } else {
          this._lastError = "unsupported auth sub-type " + sub;
          this._consumeCurrentFrame();
          return false;
        }
        continue;
      }
      this._consumeCurrentFrame();
      if (t === T_ERROR) return false;
      if (t === T_READY) {
        this.connected = 1;
        return true;
      }
    }
    return false;
  }

  query(sql: string): QueryResult {
    const result: QueryResult = {
      fields: [],
      rows: [],
      rowCount: 0,
      command: "",
    };
    if (this.connected === 0) {
      this._lastError = "not connected";
      return result;
    }

    const sqlLen = sql.length;
    const qLen = 4 + sqlLen + 1;
    const tx = this.tx;
    tx[0] = 81; // 'Q'
    tx[1] = (qLen >> 24) & 0xff;
    tx[2] = (qLen >> 16) & 0xff;
    tx[3] = (qLen >> 8) & 0xff;
    tx[4] = qLen & 0xff;
    let i = 0;
    while (i < sqlLen) {
      tx[5 + i] = sql.charCodeAt(i) & 0xff;
      i = i + 1;
    }
    tx[5 + sqlLen] = 0;
    this.sock.writeBytes(tx, 1 + qLen);

    const deadline = Date.now() + 30000;
    while (true) {
      const t = this._pumpOneFrame(deadline);
      if (t === 0) {
        this._lastError = "query timeout / closed";
        return result;
      }
      if (t === T_ROW_DESC) {
        this._parseRowDescInto(result);
      } else if (t === T_DATA_ROW) {
        this._parseDataRowInto(result);
      } else if (t === T_CMD_DONE) {
        result.command = this._parseCString(this._framePayloadOff, this._framePayloadEnd);
      } else if (t === T_ERROR) {
        // _lastError already set in _pumpOneFrame
      }
      this._consumeCurrentFrame();
      if (t === T_READY) return result;
    }
    return result;
  }

  // Extended protocol: Parse + Bind + Describe + Execute + Sync.
  // params are text-encoded (format 0) — pass numbers as their string form.
  // Empty string "" is sent as length=0. NULL parameters not yet supported
  // (needs a sentinel distinct from "").
  queryParams(sql: string, params: string[]): QueryResult {
    const result: QueryResult = {
      fields: [],
      rows: [],
      rowCount: 0,
      command: "",
    };
    if (this.connected === 0) {
      this._lastError = "not connected";
      return result;
    }

    const tx = this.tx;
    let off = 0;

    // ---- Parse 'P' ----
    const pStart = off;
    tx[off] = 80; // 'P'
    off = off + 5;
    tx[off] = 0; // unnamed prepared stmt
    off = off + 1;
    const sqlLen = sql.length;
    let si = 0;
    while (si < sqlLen) {
      tx[off + si] = sql.charCodeAt(si) & 0xff;
      si = si + 1;
    }
    off = off + sqlLen;
    tx[off] = 0;
    off = off + 1;
    tx[off] = 0;
    tx[off + 1] = 0; // numParamTypes=0 (server infers)
    off = off + 2;
    const pLen = off - pStart - 1;
    tx[pStart + 1] = (pLen >> 24) & 0xff;
    tx[pStart + 2] = (pLen >> 16) & 0xff;
    tx[pStart + 3] = (pLen >> 8) & 0xff;
    tx[pStart + 4] = pLen & 0xff;

    // ---- Bind 'B' ----
    const bStart = off;
    tx[off] = 66; // 'B'
    off = off + 5;
    tx[off] = 0; // unnamed portal
    off = off + 1;
    tx[off] = 0; // unnamed prepared stmt
    off = off + 1;
    tx[off] = 0;
    tx[off + 1] = 0; // numFormatCodes=0 → all text
    off = off + 2;
    const nParams = params.length;
    tx[off] = (nParams >> 8) & 0xff;
    tx[off + 1] = nParams & 0xff;
    off = off + 2;
    let pi = 0;
    while (pi < nParams) {
      const pv = params[pi];
      const pl = pv.length;
      tx[off] = (pl >> 24) & 0xff;
      tx[off + 1] = (pl >> 16) & 0xff;
      tx[off + 2] = (pl >> 8) & 0xff;
      tx[off + 3] = pl & 0xff;
      off = off + 4;
      let pj = 0;
      while (pj < pl) {
        tx[off + pj] = pv.charCodeAt(pj) & 0xff;
        pj = pj + 1;
      }
      off = off + pl;
      pi = pi + 1;
    }
    // (end of bind param loop)
    tx[off] = 0;
    tx[off + 1] = 0; // numResultFormats=0 → all text
    off = off + 2;
    const bLen = off - bStart - 1;
    tx[bStart + 1] = (bLen >> 24) & 0xff;
    tx[bStart + 2] = (bLen >> 16) & 0xff;
    tx[bStart + 3] = (bLen >> 8) & 0xff;
    tx[bStart + 4] = bLen & 0xff;

    // ---- Describe 'D' portal '' ----
    const dStart = off;
    tx[off] = 68; // 'D'
    off = off + 5;
    tx[off] = 80; // 'P'
    off = off + 1;
    tx[off] = 0;
    off = off + 1;
    const dLen = off - dStart - 1;
    tx[dStart + 1] = (dLen >> 24) & 0xff;
    tx[dStart + 2] = (dLen >> 16) & 0xff;
    tx[dStart + 3] = (dLen >> 8) & 0xff;
    tx[dStart + 4] = dLen & 0xff;

    // ---- Execute 'E' portal '' maxRows=0 ----
    const eStart = off;
    tx[off] = 69; // 'E'
    off = off + 5;
    tx[off] = 0;
    off = off + 1;
    tx[off] = 0;
    tx[off + 1] = 0;
    tx[off + 2] = 0;
    tx[off + 3] = 0;
    off = off + 4;
    const eLen = off - eStart - 1;
    tx[eStart + 1] = (eLen >> 24) & 0xff;
    tx[eStart + 2] = (eLen >> 16) & 0xff;
    tx[eStart + 3] = (eLen >> 8) & 0xff;
    tx[eStart + 4] = eLen & 0xff;

    // ---- Sync 'S' ----
    tx[off] = 83;
    tx[off + 1] = 0;
    tx[off + 2] = 0;
    tx[off + 3] = 0;
    tx[off + 4] = 4;
    off = off + 5;

    this.sock.writeBytes(tx, off);

    const deadline = Date.now() + 30000;
    while (true) {
      const t = this._pumpOneFrame(deadline);
      if (t === 0) {
        this._lastError = "query timeout / closed";
        return result;
      }
      if (t === T_ROW_DESC) {
        this._parseRowDescInto(result);
      } else if (t === T_DATA_ROW) {
        this._parseDataRowInto(result);
      } else if (t === T_CMD_DONE) {
        result.command = this._parseCString(this._framePayloadOff, this._framePayloadEnd);
      }
      this._consumeCurrentFrame();
      if (t === T_READY) return result;
    }
    return result;
  }

  private _sendCleartextPassword(): void {
    const tx = this.tx;
    const pw = this.opts.password;
    const pwLen = pw.length;
    const len = 4 + pwLen + 1;
    tx[0] = 112; // 'p'
    tx[1] = (len >> 24) & 0xff;
    tx[2] = (len >> 16) & 0xff;
    tx[3] = (len >> 8) & 0xff;
    tx[4] = len & 0xff;
    let i = 0;
    while (i < pwLen) {
      tx[5 + i] = pw.charCodeAt(i) & 0xff;
      i = i + 1;
    }
    tx[5 + pwLen] = 0;
    this.sock.writeBytes(tx, 1 + len);
  }

  private _sendMd5Password(): void {
    // inner = md5(password + username) — 32 hex chars
    const pw = this.opts.password;
    const user = this.opts.user;
    const inner = crypto.md5(pw + user);

    // combined = inner (32 ASCII bytes) + salt (4 raw bytes)
    const rx = this.rx;
    const po = this._framePayloadOff;
    const combined = new Uint8Array(36);
    let i = 0;
    while (i < 32) {
      combined[i] = inner.charCodeAt(i) & 0xff;
      i = i + 1;
    }
    combined[32] = rx[po + 4];
    combined[33] = rx[po + 5];
    combined[34] = rx[po + 6];
    combined[35] = rx[po + 7];

    const outer = crypto.md5(combined);

    // Send PasswordMessage: 'p' + len(4) + "md5" + outer + \0
    const tx = this.tx;
    const len = 4 + 3 + 32 + 1;
    tx[0] = 112; // 'p'
    tx[1] = (len >> 24) & 0xff;
    tx[2] = (len >> 16) & 0xff;
    tx[3] = (len >> 8) & 0xff;
    tx[4] = len & 0xff;
    tx[5] = 109; // 'm'
    tx[6] = 100; // 'd'
    tx[7] = 53; // '5'
    let j = 0;
    while (j < 32) {
      tx[8 + j] = outer.charCodeAt(j) & 0xff;
      j = j + 1;
    }
    tx[8 + 32] = 0;
    this.sock.writeBytes(tx, 1 + len);
  }

  // Drive a SCRAM-SHA-256 exchange from AuthenticationSASL → AuthenticationOK.
  // Assumes the current frame buffer holds the AuthenticationSASL message;
  // consumes it, runs the three-step handshake, and returns with the frame
  // buffer drained up to (not including) the final AuthenticationOK — which
  // the outer connect() loop will then see and accept.
  private _doScram(deadline: number): boolean {
    const rx = this.rx;
    const po = this._framePayloadOff;
    const pe = this._framePayloadEnd;

    // Mechanism list starts at po+4; null-terminated strings, list ends with
    // an empty string (double NUL). Check that SCRAM-SHA-256 is offered.
    let off = po + 4;
    let found = 0;
    const want = "SCRAM-SHA-256";
    const wantLen = want.length;
    while (off < pe && rx[off] !== 0) {
      let j = off;
      while (j < pe && rx[j] !== 0) {
        j = j + 1;
      }
      const mechLen = j - off;
      if (mechLen === wantLen) {
        let eq = 1;
        let k = 0;
        while (k < wantLen) {
          if (rx[off + k] !== (want.charCodeAt(k) & 0xff)) {
            eq = 0;
            k = wantLen;
          } else {
            k = k + 1;
          }
        }
        if (eq === 1) {
          found = 1;
        }
      }
      off = j + 1;
    }
    if (found === 0) {
      this._lastError = "server did not offer SCRAM-SHA-256";
      this._consumeCurrentFrame();
      return false;
    }
    this._consumeCurrentFrame();

    // ---- Step 1: send SASLInitialResponse ----
    const clientNonce = cs_scram_random_nonce_b64();
    const user = this.opts.user;
    const clientFirstBare = cs_scram_client_first_bare(user, clientNonce);
    // client-first-message = "n,," + clientFirstBare (gs2-header "n,," = no channel binding).
    const clientFirst = "n,," + clientFirstBare;
    const cfLen = clientFirst.length;
    const mech = "SCRAM-SHA-256";
    const mechLen2 = mech.length;
    // PasswordMessage body: mechanism\0 + int32 len + client-first bytes
    const bodyLen = mechLen2 + 1 + 4 + cfLen;
    const totalLen = 4 + bodyLen;
    const tx = this.tx;
    tx[0] = 112; // 'p'
    tx[1] = (totalLen >> 24) & 0xff;
    tx[2] = (totalLen >> 16) & 0xff;
    tx[3] = (totalLen >> 8) & 0xff;
    tx[4] = totalLen & 0xff;
    let oi = 5;
    let mi = 0;
    while (mi < mechLen2) {
      tx[oi + mi] = mech.charCodeAt(mi) & 0xff;
      mi = mi + 1;
    }
    tx[oi + mechLen2] = 0;
    oi = oi + mechLen2 + 1;
    tx[oi] = (cfLen >> 24) & 0xff;
    tx[oi + 1] = (cfLen >> 16) & 0xff;
    tx[oi + 2] = (cfLen >> 8) & 0xff;
    tx[oi + 3] = cfLen & 0xff;
    oi = oi + 4;
    let ci = 0;
    while (ci < cfLen) {
      tx[oi + ci] = clientFirst.charCodeAt(ci) & 0xff;
      ci = ci + 1;
    }
    oi = oi + cfLen;
    this.sock.writeBytes(tx, oi);

    // ---- Step 2: expect AuthenticationSASLContinue ----
    const t1 = this._pumpOneFrame(deadline);
    if (t1 === 0) {
      this._lastError = "scram: timeout waiting for SASLContinue";
      return false;
    }
    if (t1 === T_ERROR) {
      this._consumeCurrentFrame();
      return false;
    }
    if (t1 !== T_AUTH) {
      this._lastError = "scram: expected Authentication frame, got " + t1;
      this._consumeCurrentFrame();
      return false;
    }
    const rx2 = this.rx;
    const po2 = this._framePayloadOff;
    const pe2 = this._framePayloadEnd;
    const sub2 = (rx2[po2] << 24) | (rx2[po2 + 1] << 16) | (rx2[po2 + 2] << 8) | rx2[po2 + 3];
    if (sub2 !== AUTH_SASL_CONTINUE) {
      this._lastError = "scram: expected SASLContinue (11), got " + sub2;
      this._consumeCurrentFrame();
      return false;
    }
    // server-first-message = payload bytes after the 4-byte sub-code.
    let serverFirst = "";
    let sfi = po2 + 4;
    while (sfi < pe2) {
      serverFirst = serverFirst + String.fromCharCode(rx2[sfi]);
      sfi = sfi + 1;
    }
    this._consumeCurrentFrame();

    // ---- Step 3: derive + send SASLResponse (client-final-message) ----
    const packed = cs_scram_client_final(this.opts.password, clientFirstBare, serverFirst);
    if (packed === "ERR") {
      this._lastError = "scram: failed to derive client proof";
      return false;
    }
    // The bridge returns "<client-final>\x01<server-sig-b64>"; split on SOH.
    const packedLen = packed.length;
    let sepIdx = -1;
    let si2 = 0;
    while (si2 < packedLen) {
      if (packed.charCodeAt(si2) === 1) {
        sepIdx = si2;
        si2 = packedLen;
      } else {
        si2 = si2 + 1;
      }
    }
    if (sepIdx < 0) {
      this._lastError = "scram: malformed bridge result";
      return false;
    }
    const clientFinalLen = sepIdx;
    const serverSigB64 = packed.substring(sepIdx + 1, packedLen);

    const fLen = 4 + clientFinalLen;
    tx[0] = 112; // 'p'
    tx[1] = (fLen >> 24) & 0xff;
    tx[2] = (fLen >> 16) & 0xff;
    tx[3] = (fLen >> 8) & 0xff;
    tx[4] = fLen & 0xff;
    let fi = 0;
    while (fi < clientFinalLen) {
      tx[5 + fi] = packed.charCodeAt(fi) & 0xff;
      fi = fi + 1;
    }
    this.sock.writeBytes(tx, 1 + fLen);

    // ---- Step 4: expect AuthenticationSASLFinal and verify signature ----
    const t2 = this._pumpOneFrame(deadline);
    if (t2 === 0) {
      this._lastError = "scram: timeout waiting for SASLFinal";
      return false;
    }
    if (t2 === T_ERROR) {
      this._consumeCurrentFrame();
      return false;
    }
    if (t2 !== T_AUTH) {
      this._lastError = "scram: expected Authentication frame, got " + t2;
      this._consumeCurrentFrame();
      return false;
    }
    const rx3 = this.rx;
    const po3 = this._framePayloadOff;
    const pe3 = this._framePayloadEnd;
    const sub3 = (rx3[po3] << 24) | (rx3[po3 + 1] << 16) | (rx3[po3 + 2] << 8) | rx3[po3 + 3];
    if (sub3 !== AUTH_SASL_FINAL) {
      this._lastError = "scram: expected SASLFinal (12), got " + sub3;
      this._consumeCurrentFrame();
      return false;
    }
    let serverFinal = "";
    let sfi2 = po3 + 4;
    while (sfi2 < pe3) {
      serverFinal = serverFinal + String.fromCharCode(rx3[sfi2]);
      sfi2 = sfi2 + 1;
    }
    this._consumeCurrentFrame();

    if (cs_scram_verify_server_final(serverFinal, serverSigB64) !== 1) {
      this._lastError = "scram: server signature mismatch";
      return false;
    }
    return true;
  }

  end(): void {
    if (this.connected === 1) {
      const tx = this.tx;
      tx[0] = 88; // 'X'
      tx[1] = 0;
      tx[2] = 0;
      tx[3] = 0;
      tx[4] = 4;
      this.sock.writeBytes(tx, 5);
    }
    this.sock.end();
    this.sock.destroy();
    this.connected = 0;
  }

  private _pumpOneFrame(deadline: number): number {
    const rx = this.rx;
    const tmp = this.tmp;
    while (true) {
      if (this.rxLen >= 5) {
        const len = (rx[1] << 24) | (rx[2] << 16) | (rx[3] << 8) | rx[4];
        const total = 1 + len;
        if (this.rxLen >= total) {
          this._frameLen = total;
          this._framePayloadOff = 5;
          this._framePayloadEnd = total;
          const t = rx[0];
          if (t === T_ERROR) this._captureError();
          return t;
        }
      }
      if (Date.now() > deadline) return 0;
      this.sock.wait(50);
      const avail = this.sock.readLen() | 0;
      if (avail > 0) {
        const room = RX_CAP - this.rxLen;
        const want = avail < room ? avail : room;
        const n = this.sock.readBytes(tmp, want) | 0;
        const base = this.rxLen;
        let ci = 0;
        while (ci < n) {
          rx[base + ci] = tmp[ci];
          ci = ci + 1;
        }
        this.rxLen = base + n;
      }
      if (!this.sock.isOpen() && this.sock.readLen() === 0 && this.rxLen < 5) {
        return 0;
      }
    }
    return 0;
  }

  private _consumeCurrentFrame(): void {
    const total = this._frameLen;
    const remain = this.rxLen - total;
    const rx = this.rx;
    let i = 0;
    while (i < remain) {
      rx[i] = rx[total + i];
      i = i + 1;
    }
    this.rxLen = remain;
  }

  private _parseRowDescInto(result: QueryResult): void {
    const rx = this.rx;
    let off = this._framePayloadOff;
    const ncols = (rx[off] << 8) | rx[off + 1];
    off = off + 2;
    let c = 0;
    while (c < ncols) {
      // cstr name
      let j = off;
      while (j < this._framePayloadEnd) {
        if (rx[j] === 0) break;
        j = j + 1;
      }
      let name = "";
      let p = off;
      while (p < j) {
        name = name + String.fromCharCode(rx[p]);
        p = p + 1;
      }
      result.fields.push(name);
      off = j + 1;
      // skip tableOid(4) colAttr(2) typeOid(4) typeLen(2) typeMod(4) format(2) = 18
      off = off + 18;
      c = c + 1;
    }
  }

  private _parseDataRowInto(result: QueryResult): void {
    const rx = this.rx;
    let off = this._framePayloadOff;
    const ncols = (rx[off] << 8) | rx[off + 1];
    off = off + 2;
    const row: string[] = [];
    let c = 0;
    while (c < ncols) {
      const u = (rx[off] << 24) | (rx[off + 1] << 16) | (rx[off + 2] << 8) | rx[off + 3];
      const len = u | 0;
      off = off + 4;
      if (len < 0) {
        row.push("");
      } else {
        let s = "";
        let k = 0;
        while (k < len) {
          s = s + String.fromCharCode(rx[off + k]);
          k = k + 1;
        }
        row.push(s);
        off = off + len;
      }
      c = c + 1;
    }
    result.rows.push(row);
    result.rowCount = result.rowCount + 1;
  }

  private _parseCString(start: number, end: number): string {
    const rx = this.rx;
    let j = start;
    while (j < end) {
      if (rx[j] === 0) break;
      j = j + 1;
    }
    let s = "";
    let p = start;
    while (p < j) {
      s = s + String.fromCharCode(rx[p]);
      p = p + 1;
    }
    return s;
  }

  private _captureError(): void {
    const rx = this.rx;
    let off = this._framePayloadOff;
    let msg = "";
    let code = "";
    while (off < this._framePayloadEnd) {
      const ft = rx[off];
      off = off + 1;
      if (ft === 0) break;
      // cstr
      let j = off;
      while (j < this._framePayloadEnd) {
        if (rx[j] === 0) break;
        j = j + 1;
      }
      let s = "";
      let p = off;
      while (p < j) {
        s = s + String.fromCharCode(rx[p]);
        p = p + 1;
      }
      off = j + 1;
      if (ft === 77)
        msg = s; // 'M'
      else if (ft === 67) code = s; // 'C'
    }
    if (code.length > 0) {
      this._lastError = code + ": " + msg;
    } else {
      this._lastError = msg;
    }
  }
}

// Class-field array element access + method call hits a chad codegen
// quirk — the element's type is lost across member access, so we dispatch
// via free helpers that accept a Client parameter.

function _poolConnectOne(c: Client): boolean {
  return c.connect();
}

function _poolQuery(c: Client, sql: string): QueryResult {
  return c.query(sql);
}

function _poolQueryParams(c: Client, sql: string, params: string[]): QueryResult {
  return c.queryParams(sql, params);
}

function _poolClientError(c: Client): string {
  return c.lastError();
}

function _poolEndOne(c: Client): void {
  c.end();
}

// ---- Pool ----
//
// Round-robin over N Clients. Each query() / queryParams() picks the next
// client, lazily (re)connects it on demand, and runs the query. ChadScript's
// net stack is synchronous, so this is a connection cache + auto-reconnect +
// server-side state spread — not a parallelism primitive. Backpressure/
// async queueing lands as phase 5b once net has cooperative scheduling.

export interface PoolOpts {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  size: number;
}

export class Pool {
  private opts: PoolOpts;
  private clients: Client[];
  private alive: number[];
  private cursor: number;
  private _lastError: string;

  constructor(opts: PoolOpts) {
    this.opts = opts;
    this.clients = [];
    this.alive = [];
    this.cursor = 0;
    this._lastError = "";
    const n = opts.size < 1 ? 1 : opts.size;
    let i = 0;
    while (i < n) {
      const c = new Client({
        host: opts.host,
        port: opts.port,
        user: opts.user,
        database: opts.database,
        password: opts.password,
      });
      this.clients.push(c);
      this.alive.push(0);
      i = i + 1;
    }
  }

  lastError(): string {
    return this._lastError;
  }

  size(): number {
    return this.clients.length;
  }

  private _acquireIdx(): number {
    const n = this.clients.length;
    let attempts = 0;
    while (attempts < n) {
      const idx = this.cursor % n;
      this.cursor = this.cursor + 1;
      const c = this.clients[idx] as Client;
      if (this.alive[idx] === 0) {
        if (_poolConnectOne(c)) {
          this.alive[idx] = 1;
          return idx;
        }
        this._lastError = _poolClientError(c);
      } else {
        return idx;
      }
      attempts = attempts + 1;
    }
    return 0;
  }

  query(sql: string): QueryResult {
    const idx = this._acquireIdx();
    const c = this.clients[idx] as Client;
    const r = _poolQuery(c, sql);
    const err = _poolClientError(c);
    if (err.length > 0) {
      this.alive[idx] = 0;
      this._lastError = err;
    }
    return r;
  }

  queryParams(sql: string, params: string[]): QueryResult {
    const idx = this._acquireIdx();
    const c = this.clients[idx] as Client;
    const r = _poolQueryParams(c, sql, params);
    const err = _poolClientError(c);
    if (err.length > 0) {
      this.alive[idx] = 0;
      this._lastError = err;
    }
    return r;
  }

  end(): void {
    let i = 0;
    const n = this.clients.length;
    while (i < n) {
      if (this.alive[i] === 1) {
        const c = this.clients[i] as Client;
        _poolEndOne(c);
        this.alive[i] = 0;
      }
      i = i + 1;
    }
  }
}

// ---- Connection string parsing ----
//
// Port of perry's src/url.ts. Accepts the two libpq URL shapes:
//   postgres://[user[:password]@][host][:port][/database][?k=v&...]
//   postgresql://...
//
// Supports IPv6 bracketed hosts ([::1]:5432). Throws on malformed URLs.
// Unknown query keys are ignored (ClientOpts is minimal 5-field shape;
// sslmode/application_name/connect_timeout map onto the richer shape
// once lib/pg.ts grows it — tracked in issue #637).

function _pgHexVal(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

function _pgPercentDecode(s: string): string {
  const n = s.length;
  let out = "";
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 37 && i + 2 < n) {
      const h = _pgHexVal(s.charCodeAt(i + 1));
      const l = _pgHexVal(s.charCodeAt(i + 2));
      if (h >= 0 && l >= 0) {
        out = out + String.fromCharCode((h << 4) | l);
        i = i + 3;
        continue;
      }
    }
    if (c === 43) {
      out = out + " ";
      i = i + 1;
      continue;
    }
    out = out + String.fromCharCode(c);
    i = i + 1;
  }
  return out;
}

function _pgParseInt(s: string): number {
  const n = s.length;
  if (n === 0) return -1;
  let v = 0;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return -1;
    v = v * 10 + (c - 48);
    i = i + 1;
  }
  return v;
}

export function parseConnectionString(url: string): ClientOpts {
  const trimmed = url.trim();
  const schemeIdx = trimmed.indexOf("://");
  if (schemeIdx < 0) {
    throw new Error(
      "parseConnectionString: expected URL to start with postgres:// or postgresql://, got: " + url,
    );
  }
  const scheme = trimmed.substring(0, schemeIdx);
  if (scheme !== "postgres" && scheme !== "postgresql") {
    throw new Error(
      "parseConnectionString: expected postgres:// or postgresql:// scheme, got: " + scheme,
    );
  }

  let rest = trimmed.substring(schemeIdx + 3);

  let userinfo = "";
  const atIdx = rest.indexOf("@");
  if (atIdx >= 0) {
    userinfo = rest.substring(0, atIdx);
    rest = rest.substring(atIdx + 1);
  }

  let query = "";
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) {
    query = rest.substring(qIdx + 1);
    rest = rest.substring(0, qIdx);
  }

  let hostPort = rest;
  let database = "";
  const slashIdx = rest.indexOf("/");
  if (slashIdx >= 0) {
    hostPort = rest.substring(0, slashIdx);
    database = _pgPercentDecode(rest.substring(slashIdx + 1));
  }

  let host = "localhost";
  let port = 5432;
  if (hostPort.length > 0) {
    if (hostPort.charCodeAt(0) === 91) {
      // '[' → IPv6
      const closeBracket = hostPort.indexOf("]");
      if (closeBracket < 0) {
        throw new Error("parseConnectionString: unclosed IPv6 bracket");
      }
      host = hostPort.substring(1, closeBracket);
      if (closeBracket + 1 < hostPort.length && hostPort.charCodeAt(closeBracket + 1) === 58) {
        const pv = _pgParseInt(hostPort.substring(closeBracket + 2));
        if (pv <= 0 || pv > 65535) {
          throw new Error("parseConnectionString: invalid port in: " + hostPort);
        }
        port = pv;
      }
    } else {
      const colonIdx = hostPort.lastIndexOf(":");
      if (colonIdx >= 0) {
        host = _pgPercentDecode(hostPort.substring(0, colonIdx));
        const pv = _pgParseInt(hostPort.substring(colonIdx + 1));
        if (pv <= 0 || pv > 65535) {
          throw new Error("parseConnectionString: invalid port in: " + hostPort);
        }
        port = pv;
      } else {
        host = _pgPercentDecode(hostPort);
      }
    }
  }

  let user = "";
  let password = "";
  if (userinfo.length > 0) {
    const colonIdx = userinfo.indexOf(":");
    if (colonIdx >= 0) {
      user = _pgPercentDecode(userinfo.substring(0, colonIdx));
      password = _pgPercentDecode(userinfo.substring(colonIdx + 1));
    } else {
      user = _pgPercentDecode(userinfo);
    }
  }

  if (query.length > 0) {
    const pairs = query.split("&");
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx < 0) continue;
      const k = _pgPercentDecode(pair.substring(0, eqIdx));
      const v = _pgPercentDecode(pair.substring(eqIdx + 1));
      if (k === "user") user = v;
      else if (k === "password") password = v;
      else if (k === "dbname" || k === "database") database = v;
      else if (k === "host") host = v;
      else if (k === "port") {
        const pv = _pgParseInt(v);
        if (pv <= 0 || pv > 65535) {
          throw new Error("parseConnectionString: invalid port query param: " + v);
        }
        port = pv;
      }
    }
  }

  return {
    host: host,
    port: port,
    user: user,
    database: database,
    password: password,
  };
}
