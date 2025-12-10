import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleDestroy, OnModuleInit {
  private redisClient: any;

  constructor(private configService: ConfigService) {
    this.redisClient = createClient({
      url: this.configService.get('app.redis.url'),
      /*password: this.configService.get('app.redis.password'),
      ...(this.configService.get('app.nodeEnv') === 'production'
        ? {
            socket: {
              tls: true,
              rejectUnauthorized: true,
            },
          }
        : {}),*/
    });
  }

  async onModuleInit() {
    try {
      await this.redisClient.connect();
    } catch (error) {
      console.error('Error conectando a Redis:', error);
    }
  }

  async setUser(userId: string, userData: any): Promise<void> {
    try {
      await this.redisClient.set(`user:${userId}`, JSON.stringify(userData));
      await this.redisClient.expire(`user:${userId}`, 3600);
    } catch (error) {
    }
  }

  async getUser(userId: string): Promise<any> {
    try {
      const userData = await this.redisClient.get(`user:${userId}`);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      return null;
    }
  }

  async setUserOnline(userId: string): Promise<void> {
    try {
      await this.redisClient.sAdd('online_users', userId);
    } catch (error) {
    }
  }

  async setUserOffline(userId: string): Promise<void> {
    try {
      await this.redisClient.sRem('online_users', userId);
    } catch (error) {
    }
  }

  async getOnlineUsers(): Promise<string[]> {
    try {
      return await this.redisClient.sMembers('online_users');
    } catch (error) {
      return [];
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.redisClient.del(`user:${userId}`);
      await this.redisClient.sRem('online_users', userId);
    } catch (error) {
    }
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
  }
}
