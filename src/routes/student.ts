import { Router, Response } from 'express'
import { supabase } from '../lib/supabase'
import { uploadTaskFile } from '../lib/cloudinary'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { z } from 'zod'

const router = Router()

// ─── GET: Profile ──────────────────────────────────────────────────────────
router.get('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('users').select('*').eq('id', req.userId).single()
  if (error) return res.status(404).json({ error: 'User not found' })
  res.json(data)
})

// ─── GET: Tasks + submissions + projects ───────────────────────────────────
router.get('/tasks', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    let { data: user } = await supabase
      .from('users')
      .select('current_week, completed_weeks')
      .eq('id', req.userId)
      .single()

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          id: req.userId,
          email: req.userEmail || '',
          name: req.userEmail?.split('@')[0] || 'Student',
          role: 'student',
          current_week: 1,
          completed_weeks: 0,
        })
        .select('current_week, completed_weeks')
        .single()
      user = newUser
    }

    const { data: weeks } = await supabase
      .from('weeks')
      .select('*, tasks(*)')
      .order('week_number')

    const { data: submissions } = await supabase
      .from('task_submissions')
      .select('*')
      .eq('user_id', req.userId)

    const { data: projects } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', req.userId)

    const weeksWithStatus = (weeks || []).map(week => ({
      ...week,
      tasks: (week.tasks || []).map((task: any) => ({
        ...task,
        submission: submissions?.find(s => s.task_id === task.id) || null,
      }))
    }))

    res.json({ weeks: weeksWithStatus, user, projects: projects || [] })
  } catch (err) {
    console.error('GET /tasks error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ─── Submit schema ─────────────────────────────────────────────────────────
const submitSchema = z.object({
  task_id: z.string(),
  github_link: z.string().optional(),
  deployed_url: z.string().optional(),
  notes: z.string().max(500).optional(),
})

// ─── Shared processing logic ───────────────────────────────────────────────
async function processTaskSubmission(
  req: AuthRequest,
  res: Response,
  fileUrl: string | null,
  fileName: string | null
) {
  try {
    const parsed = submitSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' })

    const { task_id, github_link, deployed_url, notes } = parsed.data

    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('*, weeks(week_number, is_open)')
      .eq('id', task_id)
      .single()

    if (taskErr || !task) return res.status(404).json({ error: 'Task not found' })

    const weekInfo = task.weeks as any

    // ── Validate by task type ──────────────────────────────
    if (task.task_type === 'github_link') {
      if (!github_link?.trim()) {
        return res.status(400).json({ error: 'GitHub link is required' })
      }
      const parts = github_link.replace(/\/$/, '').split('/')
      const owner = parts[3]
      const repo = parts[4]
      if (!owner || !repo || parts[2] !== 'github.com') {
        return res.status(400).json({ error: 'Valid GitHub URL is required (https://github.com/username/repo)' })
      }
    }

    // BULLETPROOF LOGIC: Handle drive_link, deployed_url, and file_upload correctly
    if (task.task_type === 'deployed_url' || task.task_type === 'drive_link') {
      if (!deployed_url?.trim()) {
        return res.status(400).json({ error: 'Project URL or Drive Link is required' })
      }
    }

    if (task.task_type === 'file_upload') {
      // Agar DB mein file_upload likha hai, par student ne drive link bhej diya (Power BI ke liye)
      // Toh usko reject mat karo, allow kardo.
      if (!fileUrl && !deployed_url?.trim()) {
        return res.status(400).json({ error: 'Please upload a file or provide a Google Drive link' })
      }
    }

    // ── Get or create user ─────────────────────────────────
    let { data: user } = await supabase
      .from('users')
      .select('current_week, completed_weeks')
      .eq('id', req.userId)
      .single()

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          id: req.userId,
          email: req.userEmail || '',
          name: req.userEmail?.split('@')[0] || 'Student',
          role: 'student',
          current_week: 1,
          completed_weeks: 0,
        })
        .select('current_week, completed_weeks')
        .single()
      user = newUser
    }

    if (!user) return res.status(500).json({ error: 'User profile creation failed' })

    // ── Access checks ──────────────────────────────────────
    if (!weekInfo.is_open) {
      return res.status(403).json({ error: 'Submissions for this week are closed by the admin' })
    }
    if (weekInfo.week_number > user.current_week) {
      return res.status(403).json({ error: 'Please complete previous weeks first' })
    }

    // ── Save submission ────────────────────────────────────
    const { error: subErr } = await supabase
      .from('task_submissions')
      .upsert({
        user_id: req.userId,
        task_id,
        github_link: github_link?.trim() || null,
        deployed_url: deployed_url?.trim() || null,
        file_url: fileUrl,
        file_name: fileName,
        notes: notes || null,
        verified: true,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'user_id,task_id' })

    if (subErr) {
      console.error('Submission DB error:', subErr)
      return res.status(500).json({ error: subErr.message })
    }

    // ── Week complete check ────────────────────────────────
    const { data: weekTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('week_id', task.week_id)

    const { data: weekSubs } = await supabase
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.userId)
      .in('task_id', (weekTasks || []).map((t: any) => t.id))

    let weekCompleted = false

    if (
      weekTasks && weekSubs &&
      weekSubs.length >= weekTasks.length &&
      weekInfo.week_number === user.current_week &&
      weekInfo.week_number <= 3
    ) {
      await supabase
        .from('users')
        .update({
          current_week: weekInfo.week_number + 1,
          completed_weeks: Math.max(user.completed_weeks, weekInfo.week_number)
        })
        .eq('id', req.userId)

      weekCompleted = true
    }

    // ── Activity log ───────────────────────────────────────
    try {
      await supabase.from('activity_log').insert({
        user_id: req.userId,
        action: 'task_submitted',
        details: `Submitted: ${task.title}`,
      })
    } catch { /* ignore */ }

    res.json({ success: true, weekCompleted })

  } catch (err) {
    console.error('processTaskSubmission crash:', err)
    res.status(500).json({ error: 'Server error: ' + String(err) })
  }
}

// ─── POST: Submit task — JSON (github, form, deployed_url) ─────────────────
router.post('/submit-task', requireAuth, async (req: AuthRequest, res: Response) => {
  await processTaskSubmission(req, res, null, null)
})

// ─── POST: Submit task — file upload only ──────────────────────────────────
router.post('/submit-task-file', requireAuth, uploadTaskFile, async (req: AuthRequest, res: Response) => {
  const file = req.file as any
  await processTaskSubmission(req, res, file?.path || null, file?.originalname || null)
})

// ─── Project schema ────────────────────────────────────────────────────────
const projectSchema = z.object({
  project_type: z.enum(['mini', 'major']),
  project_category: z.string().min(1),
  title: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  github_link: z.string().optional(),
  deployed_url: z.string().optional(),
})

// ─── Shared project save logic ─────────────────────────────────────────────
async function saveProject(req: AuthRequest, res: Response, fileUrl: string | null) {
  try {
    const parsed = projectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() })

    const { data: user } = await supabase
      .from('users').select('completed_weeks').eq('id', req.userId).single()

    if (!user || user.completed_weeks < 3) {
      return res.status(403).json({ error: 'Please complete the first 3 weeks' })
    }

    const { data, error } = await supabase
      .from('projects')
      .upsert({
        user_id: req.userId,
        project_type: parsed.data.project_type,
        project_category: parsed.data.project_category,
        title: parsed.data.title,
        description: parsed.data.description || null,
        github_link: parsed.data.github_link?.trim() || null,
        deployed_url: parsed.data.deployed_url?.trim() || null,
        file_url: fileUrl,
      }, { onConflict: 'user_id,project_type' })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })

    try {
      await supabase.from('activity_log').insert({
        user_id: req.userId,
        action: 'project_submitted',
        details: `${parsed.data.project_type} project: ${parsed.data.title}`,
      })
    } catch { /* ignore */ }

    res.json({ success: true, project: data })
  } catch (err) {
    console.error('saveProject crash:', err)
    res.status(500).json({ error: 'Server error: ' + String(err) })
  }
}

// ─── POST: Submit project — JSON (no file) ─────────────────────────────────
router.post('/submit-project', requireAuth, async (req: AuthRequest, res: Response) => {
  await saveProject(req, res, null)
})

// ─── POST: Submit project — with file ──────────────────────────────────────
router.post('/submit-project-file', requireAuth, uploadTaskFile, async (req: AuthRequest, res: Response) => {
  const file = req.file as any
  await saveProject(req, res, file?.path || null)
})

// ─── GET: Student projects ─────────────────────────────────────────────────
router.get('/projects', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data } = await supabase
    .from('projects').select('*').eq('user_id', req.userId)
  res.json(data || [])
})

// ─── GET: Activity log ─────────────────────────────────────────────────────
router.get('/activity', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data } = await supabase
    .from('activity_log').select('*').eq('user_id', req.userId)
    .order('created_at', { ascending: false }).limit(20)
  res.json(data || [])
})

export default router