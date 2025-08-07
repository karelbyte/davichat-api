import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';

async function bootstrap() {
  try {
    console.log('🚀 Iniciando aplicación DaviChat...');
    
    console.log('📦 Creando aplicación NestJS...');
    const app = await NestFactory.create(AppModule);
    console.log('✅ Aplicación NestJS creada');

    console.log('🌐 Configurando CORS...');
    app.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    });
    console.log('✅ CORS configurado');

    console.log('📁 Configurando archivos estáticos...');
    app.use('/uploads', express.static('uploads'));
    console.log('✅ Archivos estáticos configurados');

    console.log('⚙️ Obteniendo configuración...');
    const configService = app.get(ConfigService);
    const port = configService.get('app.port');
    console.log(`📡 Puerto configurado: ${port}`);

    console.log('🔌 Iniciando servidor...');
    await app.listen(port);
    console.log(`✅ Aplicación ejecutándose en puerto ${port}`);
    console.log(`🌐 URL: http://localhost:${port}`);
    console.log(`🔗 WebSocket: ws://localhost:${port}`);
  } catch (error) {
    console.error('❌ Error al iniciar la aplicación:');
    console.error(`   Tipo: ${error.constructor.name}`);
    console.error(`   Mensaje: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    process.exit(1);
  }
}

bootstrap();
