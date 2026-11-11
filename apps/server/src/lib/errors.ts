export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = "authentication required") => new HttpError(401, "unauthorized", message);
export const forbidden = (message: string) => new HttpError(403, "forbidden", message);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const notConfigured = (what: string) =>
  new HttpError(503, "not_configured", `${what} is not configured on this server`);
