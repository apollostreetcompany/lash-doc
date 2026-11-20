import 'server-only';

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';

const domainDigest = (key: Buffer, purpose: string, ...parts: string[]) =>
  createHmac('sha256', key)
    .update(JSON.stringify(['lash:named-edit:v1', purpose, ...parts]))
    .digest();

type NamedEditEncryptionPurpose = 'email' | 'continuation' | 'recent';

export const normalizeNamedEditEmail = (address: string) => {
  const email = address.trim().normalize('NFC');
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at).toLowerCase();
  const rawDomain = email.slice(at + 1);
  if (
    at <= 0 ||
    !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}$/u.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[\p{L}\p{N}\p{M}.-]+$/u.test(rawDomain)
  )
    return null;
  const domain = domainToASCII(rawDomain);
  if (
    !domain.includes('.') ||
    domain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  )
    return null;
  const canonical = `${local}@${domain}`;
  return canonical.length <= 254 ? canonical : null;
};

export const namedEditEmailDigest = (key: Buffer, email: string) =>
  `email-v1-${domainDigest(key, 'email-digest', email).toString('base64url')}`;

export const namedEditInviteToken = (
  key: Buffer,
  roomId: string,
  principalId: string,
  inviteId: string,
  email: string,
) => domainDigest(key, 'invite-token', roomId, principalId, inviteId, email).toString('base64url');

export const hashNamedEditToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

export const encryptNamedEditValue = (
  key: Buffer,
  purpose: NamedEditEncryptionPurpose,
  value: string,
  ...binding: string[]
) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', domainDigest(key, purpose, ...binding), iv);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
};

export const decryptNamedEditValue = (
  key: Buffer,
  purpose: NamedEditEncryptionPurpose,
  encoded: string,
  ...binding: string[]
) => {
  if (!/^[A-Za-z0-9_-]{39,1015}$/u.test(encoded)) return null;
  const buffer = Buffer.from(encoded, 'base64url');
  if (buffer.toString('base64url') !== encoded) return null;
  try {
    const cipher = createDecipheriv(
      'aes-256-gcm',
      domainDigest(key, purpose, ...binding),
      buffer.subarray(0, 12),
    );
    cipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
