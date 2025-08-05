import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FileStorageService {
  private readonly s3Client: S3Client;
  private readonly storageType: string;
  private readonly maxSize: number;
  private readonly allowedTypes: string[];
  private readonly localPath: string;
  private readonly s3Bucket: string;

  constructor(private configService: ConfigService) {
    this.storageType =
      this.configService.get('app.fileStorage.type') || 'local';
    this.maxSize =
      this.configService.get('app.fileStorage.maxSize') || 10485760;
    const configAllowedTypes = this.configService.get('app.fileStorage.allowedTypes');
    this.allowedTypes = configAllowedTypes || [
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
    ];
    this.localPath =
      this.configService.get('app.fileStorage.local.path') || './uploads';
    this.s3Bucket =
      this.configService.get('app.fileStorage.s3.bucket') || 'chat-files';

    if (this.storageType === 'aws') {
      this.s3Client = new S3Client({
        region:
          this.configService.get('app.fileStorage.s3.region') || 'us-east-1',
        credentials: {
          accessKeyId:'AKIA537PPLJFAJ45R5F6', // this.configService.get('app.dynamodb.accessKeyId') || 'key',
          secretAccessKey: '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' // this.configService.get('app.dynamodb.secretAccessKey') || 'secret',
        },
      });
    }

    if (this.storageType === 'local') {
      this.ensureUploadDirectory();
    }
  }

  private ensureUploadDirectory() {
    if (!fs.existsSync(this.localPath)) {
      fs.mkdirSync(this.localPath, { recursive: true });
    }
  }

  validateFile(file: Express.Multer.File): {
    isValid: boolean;
    error?: string;
  } {
    if (file.size > this.maxSize) {
      return {
        isValid: false,
        error: 'File size exceeds maximum allowed size',
      };
    }

    if (!this.allowedTypes.includes(file.mimetype)) {
      return { isValid: false, error: 'File type not allowed' };
    }

    return { isValid: true };
  }

  async uploadFile(file: Express.Multer.File): Promise<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }> {
    const fileId = uuidv4();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${fileId}${fileExtension}`;

    if (this.storageType === 'local') {
      return this.uploadToLocal(file, fileName);
    } else if (this.storageType === 'aws') {
      return this.uploadToS3(file, fileName);
    } else {
      throw new Error('Invalid storage type');
    }
  }

  private async uploadToLocal(
    file: Express.Multer.File,
    fileName: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }> {
    const filePath = path.join(this.localPath, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const fileUrl = `/uploads/${fileName}`;
    const thumbnailUrl = this.isImage(file.mimetype) ? fileUrl : undefined;

    return {
      fileUrl,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      thumbnailUrl,
    };
  }

  private async uploadToS3(
    file: Express.Multer.File,
    fileName: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      const fileUrl = `https://${this.s3Bucket}.s3.amazonaws.com/${fileName}`;
      const thumbnailUrl = this.isImage(file.mimetype) ? fileUrl : undefined;

      return {
        fileUrl,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        thumbnailUrl,
      };
    } catch (error) {
      console.error('Error uploading to S3:', error);
      throw error;
    }
  }

  async deleteFile(fileUrl: string): Promise<void> {
    if (this.storageType === 'local') {
      const fileName = path.basename(fileUrl);
      const filePath = path.join(this.localPath, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else if (this.storageType === 'aws') {
      const fileName = path.basename(fileUrl);
      const command = new DeleteObjectCommand({
        Bucket: this.s3Bucket,
        Key: fileName,
      });
      await this.s3Client.send(command);
    }
  }

  private isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  private isAudio(mimeType: string): boolean {
    return mimeType.startsWith('audio/');
  }

  getFileUrl(fileName: string): string {
    if (this.storageType === 'local') {
      return `/uploads/${fileName}`;
    } else if (this.storageType === 'aws') {
      return `https://${this.s3Bucket}.s3.amazonaws.com/${fileName}`;
    }
    return '';
  }
}
