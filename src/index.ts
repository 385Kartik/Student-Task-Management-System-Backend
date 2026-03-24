import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import studentRouter from './routes/student'
import adminRouter from './routes/admin'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))

// JSON aur urlencoded — multer se pehle
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api/student', studentRouter)
app.use('/api/admin', adminRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`)
  console.log(`📚 Student API: /api/student`)
  console.log(`🔧 Admin API:   /api/admin\n`)
})

export default app