import { HttpError } from '../errors/http-error';

export interface ErrorRepresentation {
  statusCode: number;
  body: { error: string };
}

export function renderError(error: unknown): ErrorRepresentation {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message },
    };
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return {
      statusCode,
      body: { error: error instanceof Error ? error.message : 'Request error' },
    };
  }

  return {
    statusCode: 500,
    body: { error: 'Internal server error' },
  };
}
