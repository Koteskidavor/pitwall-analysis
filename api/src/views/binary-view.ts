import { createHash } from 'node:crypto';

type BinaryHeaders = Record<string, string>;

export type BinaryRepresentation =
  | { statusCode: 200; headers: BinaryHeaders; body: Buffer }
  | { statusCode: 304; headers: BinaryHeaders };

export function renderBinary(
  buffer: Buffer,
  ifNoneMatch?: string,
): BinaryRepresentation {
  const etag = `"${createHash('md5').update(buffer).digest('hex')}"`;
  const headers: BinaryHeaders = {
    ETag: etag,
    'Content-Type': 'application/octet-stream',
  };

  if (ifNoneMatch === etag) {
    return { statusCode: 304, headers };
  }

  return { statusCode: 200, headers, body: buffer };
}
