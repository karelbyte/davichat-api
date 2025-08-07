import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleDestroy, OnModuleInit {
  private redisClient: any;

  constructor(private configService: ConfigService) {
    this.redisClient = createClient({
      url: this.configService.get('app.redis.url'),
      password: this.configService.get('app.redis.password'),
    });
  }

  async onModuleInit() {
    try {
      await this.redisClient.connect();
      const redisUrl = this.configService.get('app.redis.url');
      const redisHost = this.configService.get('app.redis.host');
      const redisPort = this.configService.get('app.redis.port');
      
      console.log('✅ Conectado a servidor Redis');
      console.log(`   URL: ${redisUrl || 'No configurada'}`);
      console.log(`   Host: ${redisHost || 'No configurado'}`);
      console.log(`   Puerto: ${redisPort || 'No configurado'}`);
    } catch (error) {
      console.error('❌ Error conectando a Redis:');
      console.error(`   Tipo: ${error.constructor.name}`);
      console.error(`   Mensaje: ${error.message}`);
      console.error(`   URL: ${this.configService.get('app.redis.url')}`);
      throw error;
    }
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