import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const KEY_LEN = 32
const IV_LEN = 12
const VERIFIER_PLAINTEXT = 'inside-cofre-acessos:v1'

export interface Encrypted {
  ciphertext: string
  iv: string
  tag: string
}

/** Deriva a chave AES de 256 bits a partir da senha-mestra + salt (base64). */
export function deriveKey(masterPassword: string, saltB64: string): Buffer {
  const salt = Buffer.from(saltB64, 'base64')
  // scrypt com parâmetros interativos (N=2^15). maxmem ampliado para acomodar N.
  return scryptSync(masterPassword, salt, KEY_LEN, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

export function newSalt(): string {
  return randomBytes(16).toString('base64')
}

/** Gera uma DEK (chave dos dados) aleatória de 256 bits. */
export function newDek(): Buffer {
  return randomBytes(KEY_LEN)
}

/** "Embrulha" a DEK com uma KEK (chave derivada de senha). */
export function wrapKey(kek: Buffer, dek: Buffer): Encrypted {
  return encrypt(kek, dek.toString('base64'))
}

/** Desembrulha a DEK usando a KEK. Lança se a KEK estiver errada (falha do GCM). */
export function unwrapKey(kek: Buffer, enc: Encrypted): Buffer {
  return Buffer.from(decrypt(kek, enc), 'base64')
}

export function encrypt(key: Buffer, plaintext: string): Encrypted {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  }
}

export function decrypt(key: Buffer, enc: Encrypted): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'))
  const pt = Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, 'base64')), decipher.final()])
  return pt.toString('utf8')
}

/** Token criptografado usado para validar a senha-mestra sem guardá-la. */
export function makeVerifier(key: Buffer): Encrypted {
  return encrypt(key, VERIFIER_PLAINTEXT)
}

export function checkVerifier(key: Buffer, enc: Encrypted): boolean {
  try {
    return decrypt(key, enc) === VERIFIER_PLAINTEXT
  } catch {
    // Falha de autenticação do GCM => senha errada.
    return false
  }
}
