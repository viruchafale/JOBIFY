import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

export interface ObservabilityRequest extends Request {
  id?: string;
  startTime?: number;
}

export function requestTracker(serviceName: string) {
  return (req: ObservabilityRequest, res: Response, next: NextFunction) => {
    const requestId = (req.headers["x-request-id"] as string) || randomUUID();
    req.id = requestId;
    req.startTime = Date.now();
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      const durationMs = req.startTime ? Date.now() - req.startTime : 0;
      if (req.path !== "/health" && req.path !== "/ready") {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
            service: serviceName,
            requestId,
            method: req.method,
            path: req.originalUrl || req.url,
            status: res.statusCode,
            durationMs,
          })
        );
      }
    });

    next();
  };
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = Number(err.statusCode || err.status) || 500;
  const requestId = (req as ObservabilityRequest).id || (req.headers["x-request-id"] as string);

  const errorResponse = {
    message: err.message || "Internal Server Error",
    code: err.code || (status === 400 ? "BAD_REQUEST" : status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "INTERNAL_ERROR"),
    requestId,
    timestamp: new Date().toISOString(),
  };

  res.status(status).json(errorResponse);
}
