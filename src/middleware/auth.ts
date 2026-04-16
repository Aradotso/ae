import type { Request, Response, NextFunction } from "express";
import { getToken } from "../auth/db.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  clientId?: string;
  scope?: string;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      error_description: "Bearer token required",
    });
    return;
  }

  const token = authHeader.slice(7);
  const record = getToken(token);
  if (!record) {
    res.status(401).json({
      error: "invalid_token",
      error_description: "Token expired or invalid",
    });
    return;
  }

  req.userId = record.user_id;
  req.clientId = record.client_id;
  req.scope = record.scope;
  next();
}
