import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private redisClient: any;

  constructor(private configService: ConfigService) {
    this.redisClient = createClient({
      url: this.configService.get('app.redis.url'),
      password: this.configService.get('app.redis.password'),
    });
    this.redisClient.connect();
  }

  async setUser(userId: string, userData: any): Promise<void> {
    await this.redisClient.set(`user:${userId}`, JSON.stringify(userData));
    await this.redisClient.expire(`user:${userId}`, 3600);
  }

  async getUser(userId: string): Promise<any> {
    const userData = await this.redisClient.get(`user:${userId}`);
    return userData ? JSON.parse(userData) : null;
  }

  async setUserOnline(userId: string): Promise<void> {
    await this.redisClient.sAdd('online_users', userId);
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.redisClient.sRem('online_users', userId);
  }

  async getOnlineUsers(): Promise<string[]> {
    return await this.redisClient.sMembers('online_users');
  }

  async deleteUser(userId: string): Promise<void> {
    await this.redisClient.del(`user:${userId}`);
    await this.redisClient.sRem('online_users', userId);
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
  }
} 