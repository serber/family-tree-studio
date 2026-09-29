/**
 * Error with a translation code instead of a prebuilt message.
 * UI layers render it via t(`errors.${code}`, params); the raw
 * message still carries the code for logs.
 *
 * Kept free of TS parameter properties so Node can run dependent
 * modules directly in type-stripping mode.
 */
export class AppError extends Error {
  readonly code: string;
  readonly params?: Record<string, string | number>;

  constructor(code: string, params?: Record<string, string | number>) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
  }
}

/** An error as plain data, to cross a Worker boundary (class instances do not survive structured cloning). */
export interface ErrorData {
  code?: string;
  params?: Record<string, string | number>;
  message?: string;
}

export function errorToData(error: unknown): ErrorData {
  if (error instanceof AppError) return { code: error.code, params: error.params };
  return { message: error instanceof Error ? error.message : String(error) };
}

export function errorFromData(data: ErrorData | undefined, fallbackCode: string): Error {
  if (data?.code) return new AppError(data.code, data.params);
  return data?.message ? new Error(data.message) : new AppError(fallbackCode);
}
