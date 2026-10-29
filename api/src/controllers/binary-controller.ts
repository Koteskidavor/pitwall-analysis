import { HttpError } from '../errors/http-error';
import type { BinaryAsset, Storage } from '../models/storage';
import { renderBinary, type BinaryRepresentation } from '../views/binary-view';

export class BinaryController {
  constructor(private readonly storage: Storage) {}

  async getBinary(
    sessionId: string,
    wildcard: string,
    ifNoneMatch?: string,
  ): Promise<BinaryRepresentation> {
    const asset = parseBinaryWildcard(wildcard);

    if (!(await this.storage.hasSession(sessionId))) {
      throw new HttpError(404, 'Session not found');
    }

    const buffer = await this.storage.readBinary(sessionId, asset);
    if (!buffer) throw new HttpError(404, 'Binary data not found');

    return renderBinary(buffer, ifNoneMatch);
  }
}

function parseBinaryWildcard(wildcard: string): BinaryAsset {
  const parts = wildcard.split('/').filter((part) => part !== '');
  if (parts.length === 0) throw new HttpError(400, 'Missing binary type');
  if (parts.length > 2) throw new HttpError(400, 'Invalid binary path');

  const [type, chunkIndex] = parts;

  if (isTraversal(type) || isTraversal(chunkIndex)) {
    throw new HttpError(400, 'Invalid parameter');
  }

  if (type !== 'motion' && type !== 'gaps') {
    throw new HttpError(400, 'Invalid binary type');
  }

  if (type === 'gaps') {
    if (chunkIndex !== undefined) {
      throw new HttpError(400, 'Chunk index not allowed for gaps data');
    }
    return { type: 'gaps' };
  }

  if (chunkIndex === undefined) {
    throw new HttpError(400, 'Chunk index required for motion data');
  }
  if (!/^\d+$/.test(chunkIndex)) {
    throw new HttpError(400, 'Invalid chunk index');
  }

  return { type: 'motion', chunkIndex: Number(chunkIndex) };
}

function isTraversal(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.includes('..') || value.toLowerCase().includes('%2e%2e');
}
