import { Request, Response, NextFunction } from 'express'
import { supabase, getUserFromToken } from '../lib/supabase'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
  userEmail?: string
}

// Verify JWT token from Supabase
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]
  const user = await getUserFromToken(token)

  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Fetch role from our users table
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  req.userId = user.id
  req.userEmail = user.email
  req.userRole = profile?.role || 'student'
  next()
}

// Admin only middleware
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
