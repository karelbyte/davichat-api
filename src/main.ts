import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';

async function bootstrap() {
  try {
    console.log('\n========================================');
    console.log('🚀 Iniciando aplicación DaviChat...');
    console.log('========================================\n');

    console.log('📦 Creando aplicación NestJS...');
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    console.log('✅ Aplicación NestJS creada\n');

    console.log('🌐 Configurando CORS...');
    app.enableCors({
      origin: '*',
      methods: '*',
    });
    console.log('✅ CORS configurado\n');

    console.log('📁 Configurando archivos estáticos...');
    app.use('/uploads', express.static('uploads'));
    console.log('✅ Archivos estáticos configurados\n');

    console.log('⚙️ Obteniendo configuración...');
    const configService = app.get(ConfigService);
    const port = configService.get('app.port');
    console.log(`📡 Puerto configurado: ${port}\n`);

    console.log('🔌 Iniciando servidor...');
    await app.listen(port);
    console.log('\n========================================');
    console.log(`✅ Aplicación ejecutándose en puerto ${port}`);
    console.log(`🌐 URL: http://localhost:${port}`);
    console.log(`🔗 WebSocket: ws://localhost:${port}/ws`);
    console.log('========================================\n');
  } catch (error) {
    console.error('❌ Error al iniciar la aplicación:');
    console.error(`   Tipo: ${error.constructor.name}`);
    console.error(`   Mensaje: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    process.exit(1);
  }
}

bootstrap();
