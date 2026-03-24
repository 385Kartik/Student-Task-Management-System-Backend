import { Router, Response } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

// ─── Middleware to check if user is Admin ──────────────────────────────
async function requireAdmin(req: AuthRequest, res: Response, next: any) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.userId)
      .single()

    if (error || !user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' })
    }
    next()
  } catch (err) {
    res.status(500).json({ error: 'Server error during admin check' })
  }
}

// Apply admin check to all routes in this file
router.use(requireAuth, requireAdmin)


// ─── GET: All Students Data ───────────────────────────────────────────
router.get('/students', async (req: AuthRequest, res: Response) => {
  try {
    // 1. Get all students
    const { data: students, error: stdErr } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'student')
      .order('created_at', { ascending: false })

    if (stdErr) throw stdErr

    // 2. Get task counts and projects for these students
    const { data: taskSubs } = await supabase.from('task_submissions').select('user_id')
    const { data: projects } = await supabase.from('projects').select('user_id, project_type')
    const { data: certs } = await supabase.from('certifications').select('user_id, cert_number, pdf_url')

    // 3. Format data for the admin panel
    const formattedStudents = students?.map(s => {
      const subCount = taskSubs?.filter(ts => ts.user_id === s.id).length || 0
      const hasMini = projects?.some(p => p.user_id === s.id && p.project_type === 'mini')
      const hasMajor = projects?.some(p => p.user_id === s.id && p.project_type === 'major')
      const cert = certs?.find(c => c.user_id === s.id)

      return {
        ...s,
        submissions_count: subCount,
        mini_project: !!hasMini,
        major_project: !!hasMajor,
        certification: cert || null
      }
    })

    res.json(formattedStudents || [])
  } catch (err) {
    console.error('GET /admin/students error:', err)
    res.status(500).json({ error: 'Failed to fetch students' })
  }
})

// ─── GET: Certificate Eligible Students ────────────────────────────────
router.get('/cert-eligible', async (req: AuthRequest, res: Response) => {
  try {
    // Get students who completed 3 weeks
    const { data: eligibleUsers, error } = await supabase
      .from('users')
      .select('id, name, email, completed_weeks')
      .eq('role', 'student')
      .gte('completed_weeks', 3)

    if (error) throw error

    // Filter those who have BOTH projects and NO existing full cert
    const { data: projects } = await supabase.from('projects').select('user_id, project_type')
    const { data: certs } = await supabase.from('certifications').select('user_id')

    const fullyEligible = eligibleUsers?.filter(user => {
      const userProjects = projects?.filter(p => p.user_id === user.id) || []
      const hasMini = userProjects.some(p => p.project_type === 'mini')
      const hasMajor = userProjects.some(p => p.project_type === 'major')
      const hasCert = certs?.some(c => c.user_id === user.id)

      return hasMini && hasMajor && !hasCert
    })

    res.json(fullyEligible || [])
  } catch (err) {
    console.error('GET /admin/cert-eligible error:', err)
    res.status(500).json({ error: 'Failed to fetch eligible students' })
  }
})


// ─── GET: All Weeks Data ──────────────────────────────────────────────
router.get('/weeks', async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('weeks')
      .select('*')
      .order('week_number', { ascending: true })

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('GET /admin/weeks error:', err)
    res.status(500).json({ error: 'Failed to fetch weeks' })
  }
})


// ─── PATCH: Toggle Week Open/Close ────────────────────────────────────
router.patch('/weeks/:weekId', async (req: AuthRequest, res: Response) => {
  try {
    const { is_open } = req.body
    const { weekId } = req.params

    const { error } = await supabase
      .from('weeks')
      .update({ is_open })
      .eq('id', weekId)

    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('PATCH /admin/weeks error:', err)
    res.status(500).json({ error: 'Failed to update week' })
  }
})

// ─── GET: Single Student Detail (For Modal) ───────────────────────────
router.get('/students/:studentId', async (req: AuthRequest, res: Response) => {
  try {
    const { studentId } = req.params

    // Fetch user basic info
    const { data: user } = await supabase.from('users').select('role').eq('id', studentId).single()

    // Fetch submissions with task titles
    const { data: submissions } = await supabase
      .from('task_submissions')
      .select('task_id, submitted_at, github_link, deployed_url, file_url, tasks(title)')
      .eq('user_id', studentId)

    // Fetch projects
    const { data: projects } = await supabase
      .from('projects')
      .select('project_type, project_category, title, github_link, deployed_url, file_url')
      .eq('user_id', studentId)

    // Fetch activity log
    const { data: activity } = await supabase
      .from('activity_log')
      .select('action, details, created_at')
      .eq('user_id', studentId)
      .order('created_at', { ascending: false })

    res.json({
      role: user?.role,
      submissions: submissions || [],
      projects: projects || [],
      activity: activity || []
    })
  } catch (err) {
    console.error('GET /admin/student detail error:', err)
    res.status(500).json({ error: 'Failed to fetch student details' })
  }
})

// ─── PATCH: Promote / Demote Admin ────────────────────────────────────
router.patch('/set-role/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.body
    const { userId } = req.params

    // Prevent self-demotion
    if (userId === req.userId && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin rights' })
    }

    const { error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', userId)

    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('PATCH /admin/set-role error:', err)
    res.status(500).json({ error: 'Failed to update role' })
  }
})

// ─── POST: Issue Certificate (Mock for now) ───────────────────────────
router.post('/issue-cert/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params

    // Verify they are actually eligible (Completed 3 weeks + 2 projects)
    const { data: user } = await supabase.from('users').select('completed_weeks').eq('id', userId).single()
    if (!user || user.completed_weeks < 3) {
      return res.status(400).json({ error: 'User is not eligible yet' })
    }

    const { data: projects } = await supabase.from('projects').select('project_type').eq('user_id', userId)
    const hasMini = projects?.some(p => p.project_type === 'mini')
    const hasMajor = projects?.some(p => p.project_type === 'major')
    
    if (!hasMini || !hasMajor) {
      return res.status(400).json({ error: 'User must complete both Mini and Major projects' })
    }

    // Insert cert record
    const { error } = await supabase
      .from('certifications')
      .insert({
        user_id: userId,
        cert_type: 'full',
        completed_weeks: 4,
        // pdf_url: // PDF generation logic goes here later
      })

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    console.error('POST /admin/issue-cert error:', err)
    res.status(500).json({ error: 'Failed to issue certificate' })
  }
})

export default router