'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { Imap, parseFetch, addrOf, decodeBody } = require('../bridge/email-bridge');

// ---- HIGH #1: the From allowlist must read the HEADER block only, never the body ----
test('email: body "From:" cannot forge the sender (allowlist bypass)', () => {
  // real header From is the attacker; the body contains a forged allowed sender
  const lines = [
    '* 1 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT)] {44}',
    'From: attacker@evil.com',
    'Subject: hello',
    '',
    ' BODY[TEXT] {30}',
    'From: owner@allowed.com',
    'pay me',
    ')',
  ];
  const { from } = parseFetch(lines);
  assert.equal(addrOf(from), 'attacker@evil.com');     // the header From, not the body's
  assert.notEqual(addrOf(from), 'owner@allowed.com');
});

test('email: no header From + forged body From => empty sender (blocked)', () => {
  const lines = ['* 1 FETCH (...) {10}', 'Subject: hi', '', ' BODY[TEXT] {25}', 'From: owner@allowed.com', ')'];
  assert.equal(addrOf(parseFetch(lines).from), '');     // empty => never in any allowlist
});

test('email: addrOf pulls the bare addr-spec from a display-name From', () => {
  assert.equal(addrOf('"Max" <max@myg-media.com>'), 'max@myg-media.com');
  assert.equal(addrOf('plain@x.io'), 'plain@x.io');
});

// ---- HIGH #2: a literal body that looks like a tagged/untagged line must NOT desync the parser ----
test('email: IMAP literal body cannot inject a fake tagged completion', async () => {
  const sock = new EventEmitter(); sock.write = () => {};
  const imap = new Imap(sock);
  const pr = imap.cmd('UID FETCH 1 (BODY.PEEK[TEXT])'); // first cmd => tag U1
  // The 18-byte literal body is EXACTLY a fake completion line for our own tag.
  const fake = 'U1 OK FAKE INSIDE\n';
  assert.equal(Buffer.byteLength(fake), 18);
  const resp =
    '* 1 FETCH (BODY[TEXT] {18}\r\n' + fake + ')\r\n' +  // body is opaque literal data
    'U1 OK FETCH complete\r\n';                          // the ONLY real completion
  sock.emit('data', Buffer.from(resp, 'utf8'));
  const lines = await pr;                                // resolves on the REAL tag, not the one in the body
  const joined = lines.join('\r\n');
  assert.ok(/FAKE INSIDE/.test(joined), 'literal body content is captured, not parsed as protocol');
  assert.ok(/BODY\[TEXT\]/.test(joined), 'the FETCH line is intact');
});

test('email: a literal split across two data chunks reassembles correctly', async () => {
  const sock = new EventEmitter(); sock.write = () => {};
  const imap = new Imap(sock);
  const pr = imap.cmd('UID FETCH 2 (BODY.PEEK[TEXT])');
  sock.emit('data', Buffer.from('* 2 FETCH (BODY[TEXT] {11}\r\nHel', 'utf8')); // literal arrives in pieces
  sock.emit('data', Buffer.from('lo world)\r\n', 'utf8'));
  sock.emit('data', Buffer.from('U1 OK done\r\n', 'utf8'));
  const lines = await pr;
  assert.ok(/Hello world/.test(lines.join('\r\n')));
});

// ---- MIME decoding: real text, not raw transfer framing ----
test('email: quoted-printable decodes =XX octets and joins soft line breaks', () => {
  const headers = 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable';
  const body = 'It=E2=80=99s wrapped =\r\nacross a soft break and keeps =C3=A9 accents.';
  const out = decodeBody(headers, body);
  assert.ok(/It’s wrapped across a soft break/.test(out), 'soft break joined, =E2=80=99 -> right single quote');
  assert.ok(/keeps é accents/.test(out), '=C3=A9 -> e-acute (utf-8 multi-byte)');
  assert.ok(!/=E2|=\r?\n/.test(out), 'no raw QP framing left');
});

test('email: base64 part decodes to plain text', () => {
  const text = 'Hello from a base64 body — decoded.';
  const headers = 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64';
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{20})/g, '$1\r\n'); // wrapped like real mail
  assert.equal(decodeBody(headers, body), text);
});

// ---- SECURITY: multipart picks the real text/plain part; a forged 'From:' in the HTML part is NOT the sender ----
test('email: multipart picks text/plain and ignores a forged From in the HTML part', () => {
  const lines = [
    '* 1 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT CONTENT-TYPE)] {110}',
    'From: attacker@evil.com',
    'Subject: hi',
    'Content-Type: multipart/alternative; boundary="SEP"',
    '',
    ' BODY[TEXT] {220}',
    '--SEP',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p>From: owner@allowed.com</p><b>pay me</b>',
    '--SEP',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'the genuine plain-text body',
    '--SEP--',
    ')',
  ];
  const { from, body } = parseFetch(lines);
  assert.equal(addrOf(from), 'attacker@evil.com');     // allowlist STILL reads the real header, not the HTML part
  assert.notEqual(addrOf(from), 'owner@allowed.com');
  assert.equal(body, 'the genuine plain-text body');   // text/plain chosen, forged-From HTML part ignored
  assert.ok(!/owner@allowed\.com/.test(body), 'the forged sender never leaks into the relayed body');
});

test('email: multipart with only an HTML part falls back to stripped text', () => {
  const headers = 'Content-Type: multipart/mixed; boundary="B"';
  const body = ['--B', 'Content-Type: text/html', '', '<p>Hi <b>there</b></p><script>evil()</script>', '--B--', ''].join('\r\n');
  const out = decodeBody(headers, body);
  assert.ok(/Hi there/.test(out), 'tags stripped to text');
  assert.ok(!/<|>|evil\(\)/.test(out), 'no markup or script body left');
});

test('email: malformed MIME falls back to the raw body without throwing', () => {
  // declared multipart but no boundary anywhere => must not throw, returns the raw text
  assert.doesNotThrow(() => decodeBody('Content-Type: multipart/mixed; boundary="NOPE"', 'just raw text, no parts'));
  assert.equal(decodeBody('Content-Type: multipart/mixed; boundary="NOPE"', 'just raw text, no parts'), 'just raw text, no parts');
  // garbage headers / non-string body => still no throw
  assert.doesNotThrow(() => decodeBody(null, null));
  assert.doesNotThrow(() => decodeBody('Content-Transfer-Encoding: base64', '!!! not base64 @@@'));
});

test('email: plain text with no CTE passes through unchanged', () => {
  assert.equal(decodeBody('Content-Type: text/plain', 'just a normal line'), 'just a normal line');
  assert.equal(decodeBody('', 'no headers at all'), 'no headers at all');
});
