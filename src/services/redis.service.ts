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
      ...(this.configService.get('app.nodeEnv') === 'production'
        ? {
            tls: true,
            rejectUnauthorized: false,
          }
        : {}),
    });
  }

  async onModuleInit() {
    try {
      const redisUrl = this.configService.get('app.redis.url');
      const redisHost = this.configService.get('app.redis.host');
      const redisPort = this.configService.get('app.redis.port');
      
      console.log('🔄 Intentando conectar a Redis...');
      console.log(`   URL: ${redisUrl || 'No configurada'}`);
      console.log(`   Host: ${redisHost || 'No configurado'}`);
      console.log(`   Puerto: ${redisPort || 'No configurado'}`);
      console.log(`   TLS: ${this.configService.get('app.nodeEnv') === 'production' ? 'Habilitado' : 'Deshabilitado'}`);
      
      // Agregar timeout para la conexión
      const connectPromise = this.redisClient.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout al conectar con Redis')), 10000)
      );

      await Promise.race([connectPromise, timeoutPromise]);
      
      console.log('✅ Conectado a servidor Redis');
      console.log(`   URL: ${redisUrl || 'No configurada'}`);
      console.log(`   Host: ${redisHost || 'No configurado'}`);
      console.log(`   Puerto: ${redisPort || 'No configurado'}`);
    } catch (error) {
      console.error('❌ Error conectando a Redis:');
      console.error(`   Tipo: ${error.constructor.name}`);
      console.error(`   Mensaje: ${error.message}`);
      console.error(`   URL: ${this.configService.get('app.redis.url')}`);
      
      // No lanzar error para evitar que la aplicación se detenga
      console.warn('⚠️ Continuando sin Redis - algunas funcionalidades pueden no estar disponibles');
      console.warn('   Para habilitar Redis, configura las variables de entorno:');
      console.warn('   - REDIS_URL');
      console.warn('   - REDIS_HOST');
      console.warn('   - REDIS_PORT');
      console.warn('   - REDIS_PASSWORD (opcional)');
    }
  }

  async setUser(userId: string, userData: any): Promise<void> {
    try {
      await this.redisClient.set(`user:${userId}`, JSON.stringify(userData));
      await this.redisClient.expire(`user:${userId}`, 3600);
    } catch (error) {
      console.warn(`⚠️ Error en setUser: ${error.message}`);
    }
  }

  async getUser(userId: string): Promise<any> {
    try {
      const userData = await this.redisClient.get(`user:${userId}`);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      console.warn(`⚠️ Error en getUser: ${error.message}`);
      return null;
    }
  }

  async setUserOnline(userId: string): Promise<void> {
    try {
      await this.redisClient.sAdd('online_users', userId);
    } catch (error) {
      console.warn(`⚠️ Error en setUserOnline: ${error.message}`);
    }
  }

  async setUserOffline(userId: string): Promise<void> {
    try {
      await this.redisClient.sRem('online_users', userId);
    } catch (error) {
      console.warn(`⚠️ Error en setUserOffline: ${error.message}`);
    }
  }

  async getOnlineUsers(): Promise<string[]> {
    try {
      return await this.redisClient.sMembers('online_users');
    } catch (error) {
      console.warn(`⚠️ Error en getOnlineUsers: ${error.message}`);
      return [];
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.redisClient.del(`user:${userId}`);
      await this.redisClient.sRem('online_users', userId);
    } catch (error) {
      console.warn(`⚠️ Error en deleteUser: ${error.message}`);
    }
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
  }
}
