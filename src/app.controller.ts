import { Controller, Get, Post, Body, Param, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { DynamoDBService } from './services/dynamodb.service';
import { RedisService } from './services/redis.service';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dynamoDBService: DynamoDBService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  serveIndex(@Res() res: Response) {
    const indexPath = path.join(__dirname, '../public/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
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
      const existingConversation = await this.dynamoDBService.findPrivateConversation(
        data.participants[0],
        data.participants[1]
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
  async getConversationMessages(@Param('conversationId') conversationId: string) {
    const messages = await this.dynamoDBService.getConversationMessages(conversationId);
    return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
}
