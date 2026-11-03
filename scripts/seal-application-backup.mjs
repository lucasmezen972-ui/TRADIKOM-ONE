#!/usr/bin/env node
// Encrypt/decrypt a private restore ZIP. Key remains in a separate secret manager.
// Usage: node scripts/seal-application-backup.mjs seal|open INPUT OUTPUT [KEY_JSON]
// KEY_JSON (0600): CONNECTOR_ENCRYPTION_KEY and CONNECTOR_ENCRYPTION_KEY_VERSION.
// If omitted, those values are read from the environment. No secret is printed.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const format = 'tradikom-application-backup-v1';
const maxSize = 128 * 1024 * 1024;

function decode(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Invalid envelope');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (size !== undefined && bytes.length !== size)) {
    throw new Error('Invalid envelope');
  }
  return bytes;
}

function keyMaterial(secret, version) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 ||
      typeof version !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(version)) {
    throw new Error('Missing backup key or version');
  }
  return Buffer.from(secret, 'utf8');
}

export function seal(plaintext, secret, keyVersion) {
  const material = keyMaterial(secret, keyVersion);
  const salt = crypto.randomBytes(32), nonce = crypto.randomBytes(12);
  const key = Buffer.from(crypto.hkdfSync('sha256', material, salt,
    Buffer.from(format + ':encryption'), 32));
  const header = { format, keyVersion };
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.from(JSON.stringify({ ...header, kdf: 'HKDF-SHA256',
    cipher: 'AES-256-GCM', salt: salt.toString('base64'), nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
}

export function open(encrypted, secret, keyVersion) {
  const material = keyMaterial(secret, keyVersion), envelope = JSON.parse(encrypted);
  if (envelope.format !== format || envelope.keyVersion !== keyVersion ||
      envelope.kdf !== 'HKDF-SHA256' || envelope.cipher !== 'AES-256-GCM') {
    throw new Error('Unsupported backup envelope');
  }
  const key = Buffer.from(crypto.hkdfSync('sha256', material, decode(envelope.salt, 32),
    Buffer.from(format + ':encryption'), 32));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, decode(envelope.nonce, 12));
  decipher.setAAD(Buffer.from(JSON.stringify({ format, keyVersion })));
  decipher.setAuthTag(decode(envelope.tag, 16));
  return Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    const [action, source, target, keyFile] = process.argv.slice(2);
    if (!['seal', 'open'].includes(action) || !source || !target) throw new Error('Invalid arguments');
    const sourceStat = fs.lstatSync(source);
    if (!sourceStat.isFile() || sourceStat.size > (action === 'seal' ? maxSize / 2 : maxSize)) throw new Error('Invalid input file');
    let config = process.env;
    if (keyFile) {
      const stat = fs.lstatSync(keyFile);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Key file must be private');
      config = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    }
    const operation = action === 'seal' ? seal : open;
    const result = operation(fs.readFileSync(source), config.CONNECTOR_ENCRYPTION_KEY,
      config.CONNECTOR_ENCRYPTION_KEY_VERSION);
    fs.writeFileSync(target, result, { mode: 0o600, flag: 'wx' });
    console.log(action === 'seal' ? 'BACKUP_ENCRYPTED' : 'BACKUP_DECRYPTED');
  } catch {
    console.error('Backup operation failed; no plaintext or key logged.');
    process.exitCode = 1;
  }
}
