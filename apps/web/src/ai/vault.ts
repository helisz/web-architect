/**
 * 本地口令保险箱（用户 2026-11-05：模型配置只存本地，且要加密）。
 *
 * 做法：口令 → PBKDF2-SHA256(21 万次) 派生 256 位密钥 → AES-GCM 加密整份配置 JSON。
 * localStorage 里只放 `{ v, kdf, iter, salt, iv, ct }`，没有口令解不开。
 *
 * 三个刻意为之的选择：
 * - 每次保存都用新的 salt/iv（不复用），避免同口令两次加密产生相同密文；
 * - 迭代次数写进信封，将来调高也能解开老数据；
 * - 解密失败统一报「口令不对或配置已损坏」——区分不出是哪一种，避免当密码校验器用。
 */

import { normalizeAiConfig, type AiConfig } from './types.js';

export const VAULT_STORAGE_KEY = 'arch.ai.vault';
export const VAULT_ITERATIONS = 210_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface VaultEnvelope {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64，AES-GCM 密文（含 16 字节 tag） */
  ct: string;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const impl = globalThis.crypto?.subtle;
  if (!impl) throw new VaultError('当前浏览器不支持 WebCrypto，无法加密保存配置');
  return impl;
}

export function isVaultEnvelope(value: unknown): value is VaultEnvelope {
  if (!value || typeof value !== 'object') return false;
  const src = value as Record<string, unknown>;
  return (
    src.v === 1 &&
    src.kdf === 'PBKDF2-SHA256' &&
    typeof src.iter === 'number' &&
    typeof src.salt === 'string' &&
    typeof src.iv === 'string' &&
    typeof src.ct === 'string'
  );
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealConfig(config: AiConfig, passphrase: string): Promise<VaultEnvelope> {
  if (!passphrase) throw new VaultError('口令不能为空');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, VAULT_ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(config));
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plain as unknown as BufferSource,
  );
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: VAULT_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
  };
}

export async function openConfig(env: VaultEnvelope, passphrase: string): Promise<AiConfig> {
  if (!passphrase) throw new VaultError('口令不能为空');
  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, fromBase64(env.salt), env.iter);
  } catch {
    throw new VaultError('口令不对，或配置已损坏');
  }
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(env.iv) as unknown as BufferSource },
      key,
      fromBase64(env.ct) as unknown as BufferSource,
    );
    return normalizeAiConfig(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    // GCM 校验失败 = 口令错（或密文被改），不区分两者
    throw new VaultError('口令不对，或配置已损坏');
  }
}

export function readVault(): VaultEnvelope | null {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isVaultEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeVault(env: VaultEnvelope): void {
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(env));
}

export function clearVault(): void {
  localStorage.removeItem(VAULT_STORAGE_KEY);
}
