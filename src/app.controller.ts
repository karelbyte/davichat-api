import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';
import { DynamoDBService } from './services/dynamodb.service';
import { RedisService } from './services/redis.service';
import { FileStorageService } from './services/file-storage.service';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dynamoDBService: DynamoDBService,
    private readonly redisService: RedisService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  @Get()
  serveIndex(@Res() res: Response) {
    const indexPath = path.join(__dirname, '../public/index.html');
    console.log('Checking index path:', indexPath);
    console.log('Index exists:', fs.existsSync(indexPath));
    if (fs.existsSync(indexPath)) {
      console.log('Serving index.html');
      res.sendFile(indexPath);
    } else {
      console.log('Index not found, sending fallback message');
      res.send('Chat API running');
    }
  }

  @Get('api/users')
  async getUsers() {
    const users = await this.dynamoDBService.getAllUsers();
    const onlineUsers = await this.redisService.getOnlineUsers();

    const usersWithStatus = users.map((user) => ({
      ...user,
      isOnline: onlineUsers.includes(user.id),
    }));

    return usersWithStatus.sort((a, b) => {
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return 0;
    });
  }

  @Post('api/users')
  async createUser(@Body() userData: any) {
    await this.dynamoDBService.createUser(userData);
    return userData;
  }

  @Post('api/conversations')
  async createConversation(
    @Body()
    data: {
      type: string;
      name?: string;
      description?: string;
      participants: string[];
      createdBy: string;
    },
  ) {
    if (data.type === 'private' && data.participants.length === 2) {
      const existingConversation =
        await this.dynamoDBService.findPrivateConversation(
          data.participants[0],
          data.participants[1],
        );

      if (existingConversation) {
        return existingConversation;
      }
    }

    const conversationId = require('uuid').v4();
    const conversationData = {
      id: conversationId,
      type: data.type,
      name: data.name,
      description: data.description,
      participants: data.participants,
      createdBy: data.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.dynamoDBService.createConversation(conversationData);

    for (const userId of data.participants) {
      await this.dynamoDBService.addParticipant(conversationId, userId, {
        unreadCount: 0,
        lastReadAt: new Date().toISOString(),
        isActive: true,
      });
    }

    return conversationData;
  }

  @Post('api/conversations/:id/participants')
  async addParticipant(
    @Param('id') conversationId: string,
    @Body() data: { userId: string; addedBy: string },
  ) {
    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.dynamoDBService.addParticipant(conversationId, data.userId, {
      unreadCount: 0,
      lastReadAt: new Date().toISOString(),
      isActive: true,
    });

    return { success: true, conversationId, userId: data.userId };
  }

  @Get('api/conversations/user/:userId')
  async getUserConversations(@Param('userId') userId: string) {
    const conversations =
      await this.dynamoDBService.getUserConversations(userId);
    return conversations;
  }

  @Get('api/messages/:conversationId')
  async getConversationMessages(
    @Param('conversationId') conversationId: string,
  ) {
    const messages =
      await this.dynamoDBService.getConversationMessages(conversationId);
    return messages.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  @Post('api/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const validation = this.fileStorageService.validateFile(file);
    if (!validation.isValid) {
      throw new BadRequestException(validation.error);
    }

    const fileData = await this.fileStorageService.uploadFile(file);
    return fileData;
  }

  @Get('api/files/:fileName')
  serveFile(@Param('fileName') fileName: string, @Res() res: Response) {
    try {
      const storageType = this.fileStorageService['storageType'];
      let filePath: string;

      if (storageType === 'local') {
        filePath = path.join(this.fileStorageService['localPath'], fileName);
      } else if (storageType === 'ebs') {
        filePath = path.join(this.fileStorageService['ebsMountPath'], fileName);
      } else {
        const fileUrl = this.fileStorageService.getFileUrl(fileName);
        return res.redirect(fileUrl);
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const stats = fs.statSync(filePath);
      const fileStream = fs.createReadStream(filePath);

      res.set({
        'Content-Length': stats.size.toString(),
        'Content-Type': this.getMimeType(fileName),
        'Cache-Control': 'public, max-age=31536000',
      });

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error serving file:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  @Get('/api/users')
  async getAllUsers() {
    return await this.dynamoDBService.getAllUsers();
  }

  @Delete('/api/users/:id')
  async deleteUser(@Param('id') id: string) {
    await this.dynamoDBService.deleteUser(id);
    return { message: 'Usuario eliminado correctamente' };
  }

  @Get('/api/conversations')
  async getAllConversations() {
    return await this.dynamoDBService.getAllConversations();
  }

  @Delete('/api/conversations/:id')
  async deleteConversation(@Param('id') id: string) {
    await this.dynamoDBService.deleteConversation(id);
    return { message: 'Conversación eliminada correctamente' };
  }

  @Get('/api/messages')
  async getAllMessages() {
    return await this.dynamoDBService.getAllMessages();
  }

  @Delete('/api/messages/:id')
  async deleteMessage(@Param('id') id: string) {
    await this.dynamoDBService.deleteMessage(id);
    return { message: 'Mensaje eliminado correctamente' };
  }

  @Get('/admin')
  serveAdmin(@Res() res: Response) {
    const adminPath = path.join(__dirname, '../public/admin.html');
    console.log('Checking admin path:', adminPath);
    console.log('Admin exists:', fs.existsSync(adminPath));

    if (fs.existsSync(adminPath)) {
      console.log('Serving admin.html');
      res.sendFile(adminPath);
    } else {
      console.log('Admin not found, sending fallback message');
      res.send('Admin panel not found');
    }
  }
}
