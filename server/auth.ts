import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './crypto.ts';
import { db } from './db.ts';

export interface AuthPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

export function signAuthToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyAuthToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AuthPayload;
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi tidak ditemukan. Silakan login terlebih dahulu.' });
    return;
  }
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token tidak valid atau telah kedaluwarsa.' });
    return;
  }
  const exists = db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.userId) as
    | { id: string; role: 'user' | 'admin' }
    | undefined;
  if (!exists) {
    res.status(401).json({ error: 'Akun pengguna tidak ditemukan.' });
    return;
  }
  req.user = {
    userId: exists.id,
    email: payload.email,
    role: exists.role,
  };
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Akses ditolak. Diperlukan hak akses Administrator.' });
      return;
    }
    next();
  });
}
