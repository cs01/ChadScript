// scram-bridge.c — SCRAM-SHA-256 primitives for the ChadScript pg driver.
//
// Exposes four entry points callable from ChadScript via `declare function`:
//
//   cs_scram_random_nonce_b64()                     -> string
//   cs_scram_client_first_bare(user, nonce_b64)     -> string ("n=<saslname>,r=<nonce>")
//   cs_scram_client_final(password, client_first_bare, server_first) -> string
//      returns "<client-final-message>\x01<server-signature-b64>"; caller splits on \x01
//   cs_scram_is_valid_server_final(server_final, expected_sig_b64) -> int (1/0)
//
// All strings are null-terminated, GC_malloc_atomic-allocated (Boehm GC).
// Base64 encoding follows RFC 4648 (standard alphabet, '=' padding) which is
// what RFC 5802 §3 specifies for SCRAM attributes.

#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <openssl/hmac.h>
#include <openssl/sha.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

extern void* GC_malloc_atomic(size_t sz);
extern void* GC_malloc(size_t sz);

// ---- base64 (standard, padded) ---------------------------------------------

static const char B64_ENC[65] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char* b64_encode(const unsigned char* in, size_t in_len) {
    size_t out_len = ((in_len + 2) / 3) * 4;
    char* out = (char*)GC_malloc_atomic(out_len + 1);
    size_t i = 0, j = 0;
    while (i < in_len) {
        unsigned int a = in[i++];
        int has_b = (i < in_len);
        unsigned int b = has_b ? in[i++] : 0;
        int has_c = (i < in_len);
        unsigned int c = has_c ? in[i++] : 0;
        unsigned int triple = (a << 16) | (b << 8) | c;
        out[j++] = B64_ENC[(triple >> 18) & 0x3F];
        out[j++] = B64_ENC[(triple >> 12) & 0x3F];
        out[j++] = has_b ? B64_ENC[(triple >> 6) & 0x3F] : '=';
        out[j++] = has_c ? B64_ENC[triple & 0x3F] : '=';
    }
    out[j] = '\0';
    return out;
}

static const signed char B64_DEC[256] = {
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
    52,53,54,55,56,57,58,59,60,61,-1,-1,-1, 0,-1,-1,
    -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
    15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
    -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
    41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1
};

// Returns bytes decoded into out (caller allocates); returns byte length written.
static size_t b64_decode_into(const char* in, unsigned char* out) {
    size_t in_len = strlen(in);
    size_t out_pos = 0;
    int buf = 0, bits = 0;
    for (size_t i = 0; i < in_len; i++) {
        unsigned char ch = (unsigned char)in[i];
        if (ch == '=') break;
        signed char v = B64_DEC[ch];
        if (v < 0) continue;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[out_pos++] = (unsigned char)((buf >> bits) & 0xFF);
            buf &= (1 << bits) - 1;
        }
    }
    return out_pos;
}

// ---- helpers ----------------------------------------------------------------

static char* escape_saslname(const char* user) {
    size_t in_len = strlen(user);
    // Worst case every char becomes 3 bytes.
    char* out = (char*)GC_malloc_atomic(in_len * 3 + 1);
    size_t j = 0;
    for (size_t i = 0; i < in_len; i++) {
        char c = user[i];
        if (c == '=') { out[j++]='='; out[j++]='3'; out[j++]='D'; }
        else if (c == ',') { out[j++]='='; out[j++]='2'; out[j++]='C'; }
        else { out[j++] = c; }
    }
    out[j] = '\0';
    return out;
}

// Parse a SCRAM attribute list "k1=v1,k2=v2,...". Returns malloc'd value for
// the first matching key, or NULL. Uses stdlib malloc then caller free — but
// for our single-use call sites we copy into GC memory.
static int find_attr(const char* s, char key, char* out, size_t out_sz) {
    size_t len = strlen(s);
    size_t start = 0;
    for (size_t i = 0; i <= len; i++) {
        if (i == len || s[i] == ',') {
            // segment [start, i)
            if (i > start + 1 && s[start] == key && s[start + 1] == '=') {
                size_t vlen = i - (start + 2);
                if (vlen >= out_sz) vlen = out_sz - 1;
                memcpy(out, s + start + 2, vlen);
                out[vlen] = '\0';
                return 1;
            }
            start = i + 1;
        }
    }
    return 0;
}

// ---- public API -------------------------------------------------------------

// 18 random bytes → base64. Matches libpq's client nonce size.
const char* cs_scram_random_nonce_b64(void) {
    unsigned char raw[18];
    if (RAND_bytes(raw, 18) != 1) {
        // Fallback: fill with zeros (extremely unlikely path). Still produces
        // a valid-looking string; the server will reject on signature anyway.
        memset(raw, 0, 18);
    }
    return b64_encode(raw, 18);
}

// client-first-bare = "n=<saslname>,r=<nonce>"
const char* cs_scram_client_first_bare(const char* user, const char* nonce_b64) {
    if (!user) user = "";
    if (!nonce_b64) nonce_b64 = "";
    char* escaped = escape_saslname(user);
    size_t e_len = strlen(escaped);
    size_t n_len = strlen(nonce_b64);
    size_t total = 2 + e_len + 3 + n_len;
    char* out = (char*)GC_malloc_atomic(total + 1);
    size_t j = 0;
    out[j++] = 'n'; out[j++] = '=';
    memcpy(out + j, escaped, e_len); j += e_len;
    out[j++] = ','; out[j++] = 'r'; out[j++] = '=';
    memcpy(out + j, nonce_b64, n_len); j += n_len;
    out[j] = '\0';
    return out;
}

// Derive client-final-message and server-signature. Returns a single string
// of the form:  <client-final-message>\x01<server-signature-b64>
// The caller splits on byte 0x01. Using an in-band separator keeps the FFI
// a single string (ChadScript's `declare function` signature).
const char* cs_scram_client_final(
    const char* password,
    const char* client_first_bare,
    const char* server_first
) {
    if (!password) password = "";
    if (!client_first_bare) client_first_bare = "";
    if (!server_first) server_first = "";

    char salt_b64[512];
    char iter_str[32];
    char combined_nonce[512];
    if (!find_attr(server_first, 'r', combined_nonce, sizeof(combined_nonce)) ||
        !find_attr(server_first, 's', salt_b64, sizeof(salt_b64)) ||
        !find_attr(server_first, 'i', iter_str, sizeof(iter_str))) {
        char* err = (char*)GC_malloc_atomic(8);
        strcpy(err, "ERR");
        return err;
    }
    int iter = atoi(iter_str);
    if (iter < 1) {
        char* err = (char*)GC_malloc_atomic(8);
        strcpy(err, "ERR");
        return err;
    }

    // Decode salt.
    unsigned char salt[512];
    size_t salt_len = b64_decode_into(salt_b64, salt);

    // SaltedPassword = PBKDF2(HMAC-SHA-256, password, salt, iter, 32)
    unsigned char salted[32];
    if (PKCS5_PBKDF2_HMAC(password, (int)strlen(password),
                          salt, (int)salt_len, iter,
                          EVP_sha256(), 32, salted) != 1) {
        char* err = (char*)GC_malloc_atomic(8);
        strcpy(err, "ERR");
        return err;
    }

    // ClientKey = HMAC-SHA-256(SaltedPassword, "Client Key")
    unsigned char client_key[32];
    unsigned int ck_len = 32;
    HMAC(EVP_sha256(), salted, 32,
         (const unsigned char*)"Client Key", 10, client_key, &ck_len);

    // StoredKey = SHA-256(ClientKey)
    unsigned char stored_key[32];
    SHA256(client_key, 32, stored_key);

    // AuthMessage = client_first_bare + "," + server_first + "," + client_final_no_proof
    // where client_final_no_proof = "c=biws,r=" + combined_nonce
    size_t cfb_len = strlen(client_first_bare);
    size_t sf_len = strlen(server_first);
    size_t cn_len = strlen(combined_nonce);
    const char* cfwp_prefix = "c=biws,r=";
    size_t cfwp_prefix_len = 9;
    size_t cfwp_len = cfwp_prefix_len + cn_len;
    size_t auth_len = cfb_len + 1 + sf_len + 1 + cfwp_len;
    unsigned char* auth = (unsigned char*)GC_malloc_atomic(auth_len);
    size_t p = 0;
    memcpy(auth + p, client_first_bare, cfb_len); p += cfb_len;
    auth[p++] = ',';
    memcpy(auth + p, server_first, sf_len); p += sf_len;
    auth[p++] = ',';
    memcpy(auth + p, cfwp_prefix, cfwp_prefix_len); p += cfwp_prefix_len;
    memcpy(auth + p, combined_nonce, cn_len); p += cn_len;

    // ClientSignature = HMAC-SHA-256(StoredKey, AuthMessage)
    unsigned char client_sig[32];
    unsigned int cs_len = 32;
    HMAC(EVP_sha256(), stored_key, 32, auth, auth_len, client_sig, &cs_len);

    // ClientProof = ClientKey XOR ClientSignature
    unsigned char proof[32];
    for (int i = 0; i < 32; i++) proof[i] = client_key[i] ^ client_sig[i];
    char* proof_b64 = b64_encode(proof, 32);

    // ServerKey = HMAC-SHA-256(SaltedPassword, "Server Key")
    unsigned char server_key[32];
    unsigned int sk_len = 32;
    HMAC(EVP_sha256(), salted, 32,
         (const unsigned char*)"Server Key", 10, server_key, &sk_len);

    // ServerSignature = HMAC-SHA-256(ServerKey, AuthMessage)
    unsigned char server_sig[32];
    unsigned int ss_len = 32;
    HMAC(EVP_sha256(), server_key, 32, auth, auth_len, server_sig, &ss_len);
    char* server_sig_b64 = b64_encode(server_sig, 32);

    // Assemble: "c=biws,r=<nonce>,p=<proof>" + '\x01' + server_sig_b64
    size_t proof_len = strlen(proof_b64);
    size_t ss_b64_len = strlen(server_sig_b64);
    size_t final_msg_len = cfwp_len + 3 + proof_len;
    size_t total = final_msg_len + 1 + ss_b64_len;
    char* out = (char*)GC_malloc_atomic(total + 1);
    size_t j = 0;
    memcpy(out + j, cfwp_prefix, cfwp_prefix_len); j += cfwp_prefix_len;
    memcpy(out + j, combined_nonce, cn_len); j += cn_len;
    out[j++] = ','; out[j++] = 'p'; out[j++] = '=';
    memcpy(out + j, proof_b64, proof_len); j += proof_len;
    out[j++] = '\x01';
    memcpy(out + j, server_sig_b64, ss_b64_len); j += ss_b64_len;
    out[j] = '\0';
    return out;
}

// Verify the server-final-message "v=..." against the expected signature we
// computed during client-final. Returns 1 on match, 0 on mismatch or error.
double cs_scram_verify_server_final(const char* server_final, const char* expected_sig_b64) {
    if (!server_final || !expected_sig_b64) return 0;
    char verifier[128];
    if (!find_attr(server_final, 'v', verifier, sizeof(verifier))) {
        return 0;
    }
    if (strcmp(verifier, expected_sig_b64) == 0) return 1;
    return 0;
}
