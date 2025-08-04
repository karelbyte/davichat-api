import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { DynamoDBService } from './services/dynamodb.service';
import { RedisService } from './services/redis.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dynamoDBService: DynamoDBService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
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
}
