import { LocalizedError } from './i18n.js';
/** Text files are read on-device. These helpers never make network requests. */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
export const TEXT_FILE_EXTENSIONS = Object.freeze(['txt', 'json', 'md']);

export function inspectTextFile(file) {
  if (!file || typeof file.name !== 'string') throw new LocalizedError('file.select');
  const ext = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!TEXT_FILE_EXTENSIONS.includes(ext)) throw new LocalizedError('file.unsupported');
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_TEXT_FILE_BYTES) {
    throw new LocalizedError('file.size');
  }
  return ext;
}

export function decodeTextBuffer(buffer) {
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new LocalizedError('file.encoding'); }
  const result = decoded.replace(/^\uFEFF/, '');
  if (result.includes('\u0000') || /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) {
    throw new LocalizedError('file.binary');
  }
  return result;
}

export function validateJsonFile(text) {
  try { JSON.parse(text); }
  catch { throw new LocalizedError('file.json'); }
}

export function sanitizedJsonIsValid(text) {
  try { JSON.parse(text); return true; } catch { return false; }
}

export function protectedTextFilename(extension, suffix = 'protegido') {
  const safeExtension = TEXT_FILE_EXTENSIONS.includes(extension) ? extension : 'txt';
  return `safepaste-${suffix}.${safeExtension}`;
}
