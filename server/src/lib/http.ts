import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (what = 'Forbidden') => new HttpError(403, what);
export const bad = (what: string) => new HttpError(400, what);

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
/** Wraps a handler: returned values are sent as JSON, thrown errors reach the error handler. */
export const h = (fn: Handler): RequestHandler => (req, res, next) => {
  Promise.resolve()
    .then(() => fn(req, res, next))
    .then((out) => {
      if (out !== undefined && !res.headersSent) res.json(out);
    })
    .catch(next);
};

export const body = <T extends ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {});
export const query = <T extends ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.query ?? {});

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ error: `${first.path.join('.') || 'input'}: ${first.message}`, issues: err.issues });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err?.name === 'MulterError') return res.status(400).json({ error: err.message });
  // Errors that carry a client-error status (e.g. SourceError, body-parser) are safe to surface.
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
}

export const pageParams = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
