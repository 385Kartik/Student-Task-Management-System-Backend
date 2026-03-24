import cloudinary from 'cloudinary'
import { CloudinaryStorage } from 'multer-storage-cloudinary'
import multer from 'multer'
import dotenv from 'dotenv'

dotenv.config()

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
})

const taskStorage = new CloudinaryStorage({
  cloudinary: cloudinary.v2,
  params: {
    folder: 'student-tasks',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'gif'],
    resource_type: 'auto',
  } as Record<string, unknown>,
})

const certStorage = new CloudinaryStorage({
  cloudinary: cloudinary.v2,
  params: {
    folder: 'certifications',
    allowed_formats: ['pdf'],
    resource_type: 'raw',
  } as Record<string, unknown>,
})

// Only for file_upload type tasks
export const uploadTaskFile = multer({
  storage: taskStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('file')

export const uploadCertFile = multer({
  storage: certStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('cert')

export { cloudinary }