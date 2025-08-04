import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisService } from './services/redis.service';
import { DynamoDBService } from './services/dynamodb.service';
import { ChatGateway } from './gateways/chat.gateway';
import appConfig from './configs/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
  ],
  controllers: [AppController],
  providers: [AppService, RedisService, DynamoDBService, ChatGateway],
})
export class AppModule {}
