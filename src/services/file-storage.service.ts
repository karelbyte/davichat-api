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
  private readonly ebsMountPath: string;
  private readonly ebsMaxSize: number;

  constructor(private configService: ConfigService) {
    this.storageType =
      this.configService.get('app.fileStorage.type') || 'local';
    this.maxSize =
      this.configService.get('app.fileStorage.maxSize') || 10485760;
    const configAllowedTypes = this.configService.get(
      'app.fileStorage.allowedTypes',
    );
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
      'audio/vnd/wave',
    ];
    this.localPath =
      this.configService.get('app.fileStorage.local.path') || './uploads';
    this.s3Bucket =
      this.configService.get('app.fileStorage.s3.bucket') || 'chat-files';
    this.ebsMountPath =
      this.configService.get('app.fileStorage.ebs.mountPath') || '/mnt/ebs-uploads';
    this.ebsMaxSize =
      this.configService.get('app.fileStorage.ebs.maxSize') || 107374182400;

    if (this.storageType === 'aws') {
      this.s3Client = new S3Client({
        region:
          this.configService.get('app.fileStorage.s3.region') || 'us-east-1',
        /*...(this.configService.get('app.nodeEnv') !== 'production'
          ? {
              credentials: {
                accessKeyId:
                  this.configService.get('app.nodeEnv') === 'production'
                    ? this.configService.get('app.dynamodb.accessKeyId') ||
                      'key'
                    : 'key',
                secretAccessKey:
                  this.configService.get('app.nodeEnv') === 'production'
                    ? this.configService.get('app.dynamodb.secretAccessKey') ||
                      'secret'
                    : 'secret',
              },
            }
          : {}),*/
      });
    }

    if (this.storageType === 'local') {
      this.ensureUploadDirectory();
    } else if (this.storageType === 'ebs') {
      this.ensureEbsDirectory();
    }
  }

  private ensureUploadDirectory() {
    if (!fs.existsSync(this.localPath)) {
      fs.mkdirSync(this.localPath, { recursive: true });
    }
  }

  private ensureEbsDirectory() {
    if (!fs.existsSync(this.ebsMountPath)) {
      fs.mkdirSync(this.ebsMountPath, { recursive: true });
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
    } else if (this.storageType === 'ebs') {
      return this.uploadToEbs(file, fileName);
    } else {
      throw new Error(`Invalid storage type: ${this.storageType}`);
    }
  }

  async uploadUserAvatar(
    file: Express.Multer.File,
    userId: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }> {
    const fileId = uuidv4();
    const fileExtension = path.extname(file.originalname);
    const fileName = `avatar_${fileId}${fileExtension}`;

    if (this.storageType === 'local') {
      return this.uploadAvatarToLocal(file, fileName, userId);
    } else if (this.storageType === 'aws') {
      return this.uploadAvatarToS3(file, fileName, userId);
    } else if (this.storageType === 'ebs') {
      return this.uploadAvatarToEbs(file, fileName, userId);
    } else {
      throw new Error(`Invalid storage type: ${this.storageType}`);
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

    const fileUrl = `/api/files/${fileName}`;
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

  private async uploadToEbs(
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
      const filePath = path.join(this.ebsMountPath, fileName);
      fs.writeFileSync(filePath, file.buffer);

      const fileUrl = `/api/files/${fileName}`;
      const thumbnailUrl = this.isImage(file.mimetype) ? fileUrl : undefined;

      return {
        fileUrl,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        thumbnailUrl,
      };
    } catch (error) {
      console.error('Error uploading to EBS:', error);
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
    } else if (this.storageType === 'ebs') {
      const fileName = path.basename(fileUrl);
      const filePath = path.join(this.ebsMountPath, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
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
    } else if (this.storageType === 'ebs') {
      return `/mnt/ebs-uploads/${fileName}`;
    }
    return '';
  }

  private async uploadAvatarToLocal(
    file: Express.Multer.File,
    fileName: string,
    userId: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }> {
    const userAvatarDir = path.join(this.localPath, 'avatars', userId);

    // Crear directorio del usuario si no existe
    if (!fs.existsSync(userAvatarDir)) {
      fs.mkdirSync(userAvatarDir, { recursive: true });
    }

    const filePath = path.join(userAvatarDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    const fileUrl = `/api/files/avatars/${userId}/${fileName}`;
    const thumbnailUrl = this.isImage(file.mimetype) ? fileUrl : undefined;

    return {
      fileUrl,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      thumbnailUrl,
    };
  }

  private async uploadAvatarToS3(
    file: Express.Multer.File,
    fileName: string,
    userId: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }> {
    try {
      const s3Key = `avatars/${userId}/${fileName}`;
      const command = new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      const fileUrl = `https://${this.s3Bucket}.s3.amazonaws.com/${s3Key}`;
      const thumbnailUrl = this.isImage(file.mimetype) ? fileUrl : undefined;

      return {
        fileUrl,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        thumbnailUrl,
      };
    } catch (error) {
      console.error('Error uploading avatar to S3:', error);
      throw error;
    }
  }

  private async uploadAvatarToEbs(
    file: Express.Multer.File,
    fileName: string,
    userId: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }> {
    try {
      const userAvatarDir = path.join(this.ebsMountPath, 'avatars', userId);

      // Crear directorio del usuario si no existe
      if (!fs.existsSync(userAvatarDir)) {
        fs.mkdirSync(userAvatarDir, { recursive: true });
      }

      const filePath = path.join(userAvatarDir, fileName);
      fs.writeFileSync(filePath, file.buffer);

      const fileUrl = `/api/files/avatars/${userId}/${fileName}`;
      const thumbnailUrl = this.isImage(file.mimetype) ? fileUrl : undefined;

      return {
        fileUrl,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        thumbnailUrl,
      };
    } catch (error) {
      console.error('Error uploading avatar to EBS:', error);
      throw error;
    }
  }
}
