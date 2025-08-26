import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisService } from './services/redis.service';
import { DynamoDBService } from './services/dynamodb.service';
import { FileStorageService } from './services/file-storage.service';
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
  providers: [
    {
      provide: 'INIT_LOGGER',
      useFactory: () => {
        console.log('🔧 Inicializando módulo AppModule...');
        return 'AppModule initialized';
      },
    },
    AppService,
    RedisService,
    DynamoDBService,
    FileStorageService,
    ChatGateway,
  ],
})
export class AppModule {}
