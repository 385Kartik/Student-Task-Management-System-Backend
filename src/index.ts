import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import studentRouter from './routes/student'
import adminRouter from './routes/admin'

dotenv.config()

const app = express()

// ─── PRODUCTION SETTINGS ──────────────────────────────────────────────────
// Render by default 10000 port deta hai, humne use dynamic rakha hai
const PORT = parseInt(process.env.PORT || '10000', 10)

// CORS Fix: Frontend ko allow karne ke liye
app.use(cors({
  origin: [
    'https://student-task-management-system-two.vercel.app', 
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middlewares: JSON parsing aur limits
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ─── ROUTES ───────────────────────────────────────────────────────────────
app.use('/api/student', studentRouter)
app.use('/api/admin', adminRouter)

// Health check route (Render iska use karke check karta hai server zinda hai ya nahi)
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString() 
  })
})

// ─── SERVER START ─────────────────────────────────────────────────────────
// '0.0.0.0' specify karna Render/Linux deployments ke liye zaroori hai
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server is LIVE on port ${PORT}`)
  console.log(`📚 Student API: /api/student`)
  console.log(`🔧 Admin API:   /api/admin\n`)
})

export default app