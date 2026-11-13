/**
 * FILE: sns-verify.ts
 * PURPOSE: Verify one inbound Amazon SNS HTTPS delivery before anything acts
 *          on it (webhooks-cloudwatch, ADR 0061).
 *
 * SNS posts a JSON envelope with `Content-Type: text/plain; charset=UTF-8`,
 * so the body is parsed as JSON whatever the content type says. The
 * `x-amz-sns-message-type` header is not signed and is never trusted: the
 * message type comes from the signed `Type` field.
 *
 * Checks, in order:
 *   1. the body is an SNS envelope of a known Type;
 *   2. its TopicArn is a topic this Mushi bound to a project (unknown → 403,
 *      before any network call, so a forged body cannot make us fetch);
 *   3. SigningCertURL is https on exactly `sns.<topic region>.amazonaws.com`
 *      and names a `.pem` (for the bound us-east-1 topic:
 *      `sns.us-east-1.amazonaws.com`);
 *   4. SignatureVersion 1 (RSA-SHA1) or 2 (RSA-SHA256) verifies over the
 *      canonical string AWS defines for that Type;
 *   5. the Timestamp is recent (SNS retries an HTTP delivery for minutes,
 *      not hours);
 *   6. the MessageId was not already accepted (SNS delivers at least once).
 *
 * Canonical string (docs.aws.amazon.com/sns/latest/dg/
 * sns-verify-signature-of-message-verify-message-signature.html, read
 * 2026-11-13): `Key\nValue\n` for each field in this fixed byte order, with
 * one trailing newline after the last value and nothing else:
 *   - Notification: Message, MessageId, Subject (only when present),
 *     Timestamp, TopicArn, Type
 *   - SubscriptionConfirmation / UnsubscribeConfirmation: Message, MessageId,
 *     SubscribeURL, Timestamp, Token, TopicArn, Type
 *
 * The certificate's public key is read from its DER with a minimal parser and
 * verified with WebCrypto (RSASSA-PKCS1-v1_5), which behaves the same in the
 * Deno edge runtime and in Node/vitest. Pure apart from the injected deps.
 */

export type SnsMessageType = 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';

const SNS_TYPES: ReadonlySet<string> = new Set(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']);

export interface SnsEnvelope {
  Type: SnsMessageType;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
  UnsubscribeURL?: string;
}

/** How old a delivery's Timestamp may be. SNS's default HTTP retry policy gives up within minutes. */
export const SNS_MAX_AGE_MS = 60 * 60 * 1000;
/** A delivery stamped this far in the future is refused too (clock skew allowance). */
export const SNS_MAX_FUTURE_MS = 5 * 60 * 1000;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Parse an SNS body. Null when it is not JSON or not an SNS envelope of a known Type. */
export function parseSnsBody(raw: string): SnsEnvelope | null {
  let o: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = str(o.Type);
  if (!type || !SNS_TYPES.has(type)) return null;
  const required = ['MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'] as const;
  for (const k of required) if (typeof o[k] !== 'string') return null;
  const env: SnsEnvelope = {
    Type: type as SnsMessageType,
    MessageId: o.MessageId as string,
    TopicArn: o.TopicArn as string,
    Message: o.Message as string,
    Timestamp: o.Timestamp as string,
    SignatureVersion: o.SignatureVersion as string,
    Signature: o.Signature as string,
    SigningCertURL: o.SigningCertURL as string,
  };
  // Subject is signed only when present; a JSON null is "not present".
  if (typeof o.Subject === 'string') env.Subject = o.Subject;
  if (typeof o.SubscribeURL === 'string') env.SubscribeURL = o.SubscribeURL;
  if (typeof o.Token === 'string') env.Token = o.Token;
  if (typeof o.UnsubscribeURL === 'string') env.UnsubscribeURL = o.UnsubscribeURL;
  return env;
}

/** The canonical string SNS signed, per message type. Null when a signed field is missing. */
export function snsStringToSign(m: SnsEnvelope): string | null {
  const fields: Array<keyof SnsEnvelope> =
    m.Type === 'Notification'
      ? ['Message', 'MessageId', ...(m.Subject !== undefined ? (['Subject'] as const) : []), 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  let out = '';
  for (const k of fields) {
    const v = m[k];
    if (typeof v !== 'string') return null;
    out += `${k}\n${v}\n`;
  }
  return out;
}

/** `{ region, account, name }` of an SNS topic ARN, else null. */
export function parseTopicArn(arn: string): { region: string; account: string; name: string } | null {
  const m = /^arn:aws:sns:([a-z]{2}(?:-[a-z]+)+-\d):(\d{12}):([A-Za-z0-9_-]{1,256})$/.exec(arn);
  return m ? { region: m[1], account: m[2], name: m[3] } : null;
}

/** True when `raw` is https on exactly `sns.<region>.amazonaws.com`, default port, no credentials. */
export function isSnsHostUrl(raw: string, region: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    u.hostname === `sns.${region}.amazonaws.com` &&
    u.port === '' &&
    u.username === '' &&
    u.password === ''
  );
}

/** A SigningCertURL we will fetch: an SNS host of the topic's region, a `.pem` path. */
export function isTrustedCertUrl(raw: string, region: string): boolean {
  if (!isSnsHostUrl(raw, region)) return false;
  return /^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/.test(new URL(raw).pathname);
}

/**
 * A SubscribeURL we will GET: an SNS host of the topic's region asking to
 * ConfirmSubscription for exactly this topic.
 */
export function isTrustedSubscribeUrl(raw: string, region: string, topicArn: string): boolean {
  if (!isSnsHostUrl(raw, region)) return false;
  const u = new URL(raw);
  return u.searchParams.get('Action') === 'ConfirmSubscription' && u.searchParams.get('TopicArn') === topicArn;
}

// ── Certificate → SubjectPublicKeyInfo (minimal DER reader) ─────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface DerNode {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset just past the content. */
  end: number;
}

function readDer(buf: Uint8Array, offset: number): DerNode {
  if (offset + 2 > buf.length) throw new Error('DER: truncated header');
  const tag = buf[offset];
  let len = buf[offset + 1];
  let p = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || p + n > buf.length) throw new Error('DER: bad length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i];
    p += n;
  }
  if (p + len > buf.length) throw new Error('DER: truncated content');
  return { tag, start: offset, contentStart: p, end: p + len };
}

function derChildren(buf: Uint8Array, node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  let p = node.contentStart;
  while (p < node.end) {
    const child = readDer(buf, p);
    out.push(child);
    p = child.end;
  }
  return out;
}

/**
 * The DER-encoded SubjectPublicKeyInfo of the first certificate in a PEM.
 * X.509: Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm,
 * signature }; tbsCertificate ::= SEQUENCE { [0] version OPTIONAL,
 * serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo, … }.
 */
export function spkiFromCertificatePem(pem: string): Uint8Array {
  const m = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/.exec(pem);
  if (!m) throw new Error('not a PEM certificate');
  const der = base64ToBytes(m[1]);
  const cert = readDer(der, 0);
  if (cert.tag !== 0x30) throw new Error('certificate is not a SEQUENCE');
  const [tbs] = derChildren(der, cert);
  if (!tbs || tbs.tag !== 0x30) throw new Error('tbsCertificate is not a SEQUENCE');
  const fields = derChildren(der, tbs);
  const i = fields[0]?.tag === 0xa0 ? 6 : 5;
  const spki = fields[i];
  if (!spki || spki.tag !== 0x30) throw new Error('subjectPublicKeyInfo not found');
  return der.slice(spki.start, spki.end);
}

/** Verify an RSA PKCS#1 v1.5 signature over `data` with the certificate's key. */
export async function verifyRsaWithCertificate(
  pem: string,
  hash: 'SHA-1' | 'SHA-256',
  signatureB64: string,
  data: string,
): Promise<boolean> {
  const spki = spkiFromCertificatePem(pem);
  const key = await crypto.subtle.importKey('spki', spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  let sig: Uint8Array;
  try {
    sig = base64ToBytes(signatureB64);
  } catch {
    return false;
  }
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig as BufferSource, new TextEncoder().encode(data) as BufferSource);
}

// ── The verdict ─────────────────────────────────────────────────────────────

export type SnsVerdict =
  | { ok: true; message: SnsEnvelope; projectId: string; region: string }
  | {
      ok: false;
      status: 400 | 401 | 403 | 409;
      code:
        | 'NOT_SNS'
        | 'UNKNOWN_TOPIC'
        | 'UNTRUSTED_CERT_URL'
        | 'BAD_SIGNATURE_VERSION'
        | 'CERT_UNAVAILABLE'
        | 'BAD_SIGNATURE'
        | 'STALE'
        | 'DUPLICATE';
      auditOutcome: 'error' | 'rejected_signature' | 'rejected_replay';
      message: string;
      /** Set once the envelope parsed and its topic is bound. */
      projectId?: string;
      messageId?: string;
    };

export interface SnsVerifyDeps {
  /** The Mushi project bound to this topic ARN, or null. */
  projectForTopic: (topicArn: string) => Promise<string | null>;
  /** The PEM at a trusted cert URL (cached by the caller if it likes). Throws on failure. */
  fetchCertPem: (url: string) => Promise<string>;
  /** True when a delivery with this MessageId (or this body) was already accepted. */
  isReplay: (messageId: string) => Promise<boolean>;
}

export async function verifySnsDelivery(input: { body: string; nowMs: number }, deps: SnsVerifyDeps): Promise<SnsVerdict> {
  const msg = parseSnsBody(input.body);
  if (!msg) {
    return { ok: false, status: 400, code: 'NOT_SNS', auditOutcome: 'error', message: 'Body is not an SNS message' };
  }
  const topic = parseTopicArn(msg.TopicArn);
  const projectId = topic ? await deps.projectForTopic(msg.TopicArn) : null;
  if (!topic || !projectId) {
    return {
      ok: false,
      status: 403,
      code: 'UNKNOWN_TOPIC',
      auditOutcome: 'rejected_signature',
      message: 'TopicArn is not bound to a Mushi project',
      messageId: msg.MessageId,
    };
  }
  const base = { projectId, messageId: msg.MessageId };
  if (!isTrustedCertUrl(msg.SigningCertURL, topic.region)) {
    return {
      ok: false,
      status: 403,
      code: 'UNTRUSTED_CERT_URL',
      auditOutcome: 'rejected_signature',
      message: `SigningCertURL must be https://sns.${topic.region}.amazonaws.com/SimpleNotificationService-….pem`,
      ...base,
    };
  }
  const hash = msg.SignatureVersion === '1' ? 'SHA-1' : msg.SignatureVersion === '2' ? 'SHA-256' : null;
  const toSign = snsStringToSign(msg);
  if (!hash || !toSign) {
    return {
      ok: false,
      status: 401,
      code: 'BAD_SIGNATURE_VERSION',
      auditOutcome: 'rejected_signature',
      message: 'SignatureVersion must be 1 or 2 and every signed field present',
      ...base,
    };
  }
  let pem: string;
  try {
    pem = await deps.fetchCertPem(msg.SigningCertURL);
  } catch (err) {
    return {
      ok: false,
      status: 401,
      code: 'CERT_UNAVAILABLE',
      auditOutcome: 'rejected_signature',
      message: `Signing certificate could not be read: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
      ...base,
    };
  }
  let valid = false;
  try {
    valid = await verifyRsaWithCertificate(pem, hash, msg.Signature, toSign);
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, status: 401, code: 'BAD_SIGNATURE', auditOutcome: 'rejected_signature', message: 'SNS signature does not verify', ...base };
  }
  const sentAt = Date.parse(msg.Timestamp);
  if (!Number.isFinite(sentAt) || input.nowMs - sentAt > SNS_MAX_AGE_MS || sentAt - input.nowMs > SNS_MAX_FUTURE_MS) {
    return { ok: false, status: 401, code: 'STALE', auditOutcome: 'rejected_signature', message: 'SNS Timestamp is outside the accepted window', ...base };
  }
  if (await deps.isReplay(msg.MessageId)) {
    return { ok: false, status: 409, code: 'DUPLICATE', auditOutcome: 'rejected_replay', message: 'MessageId already processed', ...base };
  }
  return { ok: true, message: msg, projectId, region: topic.region };
}
