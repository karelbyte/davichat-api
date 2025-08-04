import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  const configService = app.get(ConfigService);
  const port = configService.get('app.port');
  await app.listen(port);
  console.log(`App running on port ${port}`);
}
bootstrap();
