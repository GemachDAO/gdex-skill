/**
 * Custom error classes for the GdexSkill SDK.
 */
import { GdexErrorCode } from '../types/common';

/**
 * Base error class for all GdexSkill errors.
 */
export class GdexError extends Error {
  /** Error code for programmatic handling */
  readonly code: GdexErrorCode;

  constructor(message: string, code: GdexErrorCode = GdexErrorCode.UNKNOWN) {
    super(message);
    this.name = 'GdexError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when authentication fails or a session has expired.
 */
export class GdexAuthError extends GdexError {
  /** HTTP status code that triggered the error */
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message, statusCode === 401 ? GdexErrorCode.AUTH_REQUIRED : GdexErrorCode.AUTH_FAILED);
    this.name = 'GdexAuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when input validation fails.
 */
export class GdexValidationError extends GdexError {
  /** Field that failed validation */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, GdexErrorCode.VALIDATION_ERROR);
    this.name = 'GdexValidationError';
    this.field = field;
  }
}

/**
 * Thrown when the backend returns a non-success HTTP response.
 */
export class GdexApiError extends GdexError {
  /** HTTP status code */
  readonly statusCode: number;
  /** Raw response body */
  readonly responseBody?: Record<string, unknown>;

  constructor(message: string, statusCode: number, responseBody?: Record<string, unknown>) {
    const code = statusCode === 404 ? GdexErrorCode.NOT_FOUND : GdexErrorCode.API_ERROR;
    super(message, code);
    this.name = 'GdexApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when there is a network-level failure (timeout, DNS, etc.).
 */
export class GdexNetworkError extends GdexError {
  constructor(message: string, code: GdexErrorCode = GdexErrorCode.NETWORK_ERROR) {
    super(message, code);
    this.name = 'GdexNetworkError';
  }
}

/**
 * Thrown when the API rate limit is exceeded.
 */
export class GdexRateLimitError extends GdexError {
  /** Seconds until the rate limit resets */
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message, GdexErrorCode.RATE_LIMITED);
    this.name = 'GdexRateLimitError';
    this.retryAfter = retryAfter;
  }
}
