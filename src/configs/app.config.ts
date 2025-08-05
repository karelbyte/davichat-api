import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  dynamodb: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    endpoint: process.env.DYNAMODB_ENDPOINT,
  },
  socket: {
    corsOrigin: '*',
  },
  fileStorage: {
    type: process.env.FILE_STORAGE_TYPE || 'local',
    maxSize: parseInt(process.env.FILE_UPLOAD_MAX_SIZE || '10485760', 10),
    allowedTypes: process.env.FILE_ALLOWED_TYPES?.split(',') || [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/m4a',
      'audio/webm',
      'audio/wave',
      'audio/x-wav',
      'audio/x-pn-wav',
      'audio/vnd.wave',
    ],
    local: {
      path: process.env.FILE_STORAGE_LOCAL_PATH || './uploads',
    },
    s3: {
      bucket: process.env.FILE_STORAGE_S3_BUCKET || 'chat-files',
      region: process.env.FILE_STORAGE_S3_REGION || 'us-east-1',
    },
  },
}));
