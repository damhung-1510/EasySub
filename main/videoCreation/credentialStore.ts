import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
export interface SecretCodec {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export function createCredentialStore(root: string, codec: SecretCodec) {
  const session = new Map<string, string>();
  const file = path.join(root, 'credentials.json');
  let tail = Promise.resolve();
  const valid = (id: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('INVALID_PROVIDER_ID');
  };
  async function read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  return {
    async save(id: string, secret: string) {
      valid(id);
      if (!secret.trim()) throw Error('EMPTY_CREDENTIAL');
      if (!codec.isEncryptionAvailable()) {
        session.set(id, secret);
        return 'session' as const;
      }
      const operation = tail.then(async () => {
        const contents = await read();
        contents[id] = codec.encryptString(secret).toString('base64');
        await fs.mkdir(root, { recursive: true });
        await atomicReplaceTextFile(file, JSON.stringify(contents));
        await fs.chmod(file, 0o600);
        session.delete(id);
      });
      tail = operation.catch(() => {});
      await operation;
      return 'encrypted' as const;
    },
    async get(id: string) {
      valid(id);
      if (session.has(id)) return session.get(id)!;
      if (!codec.isEncryptionAvailable()) throw Error('CREDENTIAL_REQUIRED');
      const encrypted = (await read())[id];
      if (!encrypted) throw Error('CREDENTIAL_REQUIRED');
      try {
        return codec.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {
        throw Error('CREDENTIAL_UNAVAILABLE');
      }
    },
    async status(id: string): Promise<'encrypted' | 'session' | 'none'> {
      if (session.has(id)) return 'session';
      if (!codec.isEncryptionAvailable()) return 'none';
      const encrypted = (await read())[id];
      if (!encrypted) return 'none';
      try {
        codec.decryptString(Buffer.from(encrypted, 'base64'));
        return 'encrypted';
      } catch {
        return 'none';
      }
    },
  };
}
