import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

@Injectable()
export class DynamoDBService implements OnModuleInit {
  private readonly client: DynamoDBDocumentClient;
  private readonly dynamoClient: DynamoDBClient;

  constructor(private configService: ConfigService) {
    this.dynamoClient = new DynamoDBClient({
      region: this.configService.get('app.dynamodb.region') || 'us-east-1',
      ...(this.configService.get('app.nodeEnv') !== 'production'
        ? {
            credentials: {
              accessKeyId:
                this.configService.get('app.dynamodb.accessKeyId') || '',
              secretAccessKey:
                this.configService.get('app.dynamodb.secretAccessKey') || '',
            },
          }
        : {}),
      endpoint: this.configService.get('app.dynamodb.endpoint'),
    });
    this.client = DynamoDBDocumentClient.from(this.dynamoClient);
  }

  async onModuleInit() {
    try {
      const region =
        this.configService.get('app.dynamodb.region') || 'us-east-1';
      const endpoint = this.configService.get('app.dynamodb.endpoint');
      const accessKeyId = this.configService.get('app.dynamodb.accessKeyId');

      console.log('✅ Conectado a servidor DynamoDB');
      console.log(`   Región: ${region}`);
      console.log(`   Endpoint: ${endpoint || 'AWS Cloud'}`);
      console.log(
        `   Access Key ID: ${accessKeyId ? `${accessKeyId.substring(0, 8)}...` : 'No configurado'}`,
      );

      console.log('🔄 Verificando/creando tablas de DynamoDB...');
      await this.createTablesIfNotExist();
      console.log('✅ Tablas de DynamoDB verificadas/creadas correctamente');
    } catch (error) {
      console.error('❌ Error conectando a DynamoDB:');
      console.error(`   Tipo: ${error.constructor.name}`);
      console.error(`   Mensaje: ${error.message}`);
      console.error(
        `   Región: ${this.configService.get('app.dynamodb.region')}`,
      );
      console.error(
        `   Endpoint: ${this.configService.get('app.dynamodb.endpoint')}`,
      );
      throw error;
    }
  }

  private async createTablesIfNotExist() {
    const tables = [
      {
        name: 'users',
        keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        attributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      },
      {
        name: 'conversations',
        keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        attributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      },
      {
        name: 'conversation_participants',
        keySchema: [
          { AttributeName: 'conversationId', KeyType: 'HASH' },
          { AttributeName: 'userId', KeyType: 'RANGE' },
        ],
        attributeDefinitions: [
          { AttributeName: 'conversationId', AttributeType: 'S' },
          { AttributeName: 'userId', AttributeType: 'S' },
        ],
        globalSecondaryIndexes: [
          {
            IndexName: 'userId-index',
            KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
            Projection: {
              ProjectionType: 'ALL',
            },
          },
        ],
      },
      {
        name: 'messages',
        keySchema: [
          { AttributeName: 'id', KeyType: 'HASH' },
          { AttributeName: 'conversationId', KeyType: 'RANGE' },
        ],
        attributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'conversationId', AttributeType: 'S' },
        ],
      },
    ];

    for (const table of tables) {
      console.log(`   📋 Verificando tabla: ${table.name}`);
      await this.createTableIfNotExists(table);
      console.log(`   ✅ Tabla ${table.name} lista`);
    }
  }

  private async createTableIfNotExists(tableConfig: any) {
    try {
      await this.dynamoClient.send(
        new DescribeTableCommand({ TableName: tableConfig.name }),
      );
      console.log(`      📋 Tabla ${tableConfig.name} ya existe`);
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`      🆕 Creando tabla ${tableConfig.name}...`);
        const createCommand = new CreateTableCommand({
          TableName: tableConfig.name,
          KeySchema: tableConfig.keySchema,
          AttributeDefinitions: tableConfig.attributeDefinitions,
          GlobalSecondaryIndexes: tableConfig.globalSecondaryIndexes,
          BillingMode: 'PAY_PER_REQUEST',
        });
        await this.dynamoClient.send(createCommand);
        console.log(`      ✅ Tabla ${tableConfig.name} creada exitosamente`);
      } else {
        console.error(
          `      ❌ Error verificando tabla ${tableConfig.name}:`,
          error.message,
        );
        throw error;
      }
    }
  }

  async createUser(userData: any): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: users - Operation: CREATE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new PutCommand({
      TableName: 'users',
      Item: {
        ...userData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    await this.client.send(command);
  }

  async getUser(userId: string): Promise<any> {
    const command = new GetCommand({
      TableName: 'users',
      Key: { id: userId },
    });
    const result = await this.client.send(command);
    return result.Item;
  }

  async updateUser(userId: string, updateData: any): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: users - Operation: UPDATE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    let updateExpression = 'SET updatedAt = :updatedAt';
    const expressionAttributeValues: any = {
      ':updatedAt': new Date().toISOString(),
    };

    Object.keys(updateData).forEach((key) => {
      if (key !== 'id') {
        updateExpression += `, ${key} = :${key}`;
        expressionAttributeValues[`:${key}`] = updateData[key];
      }
    });

    const command = new UpdateCommand({
      TableName: 'users',
      Key: { id: userId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    });
    await this.client.send(command);
  }

  async deleteUser(userId: string): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: users - Operation: DELETE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new DeleteCommand({
      TableName: 'users',
      Key: { id: userId },
    });
    await this.client.send(command);
  }

  async getAllUsers(): Promise<any[]> {
    const command = new ScanCommand({
      TableName: 'users',
    });
    const result = await this.client.send(command);
    return result.Items || [];
  }

  async createConversation(conversationData: any): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: conversations - Operation: CREATE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new PutCommand({
      TableName: 'conversations',
      Item: {
        ...conversationData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    await this.client.send(command);
  }

  async getConversation(conversationId: string): Promise<any> {
    const command = new GetCommand({
      TableName: 'conversations',
      Key: { id: conversationId },
    });
    const result = await this.client.send(command);
    return result.Item;
  }

  async addParticipant(
    conversationId: string,
    userId: string,
    participantData: any,
  ): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: conversation_participants - Operation: CREATE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new PutCommand({
      TableName: 'conversation_participants',
      Item: {
        conversationId,
        userId,
        ...participantData,
        joinedAt: new Date().toISOString(),
      },
    });
    await this.client.send(command);
  }

  async getConversationParticipants(conversationId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'conversation_participants',
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': conversationId,
      },
    });
    const result = await this.client.send(command);
    return result.Items || [];
  }

  async createMessage(messageData: any): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: messages - Operation: CREATE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new PutCommand({
      TableName: 'messages',
      Item: {
        ...messageData,
        timestamp: new Date().toISOString(),
      },
    });
    await this.client.send(command);
  }

  async getConversationMessages(conversationId: string): Promise<any[]> {
    const command = new ScanCommand({
      TableName: 'messages',
      FilterExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': conversationId,
      },
    });
    const result = await this.client.send(command);
    return result.Items || [];
  }

  async updateParticipantReadStatus(
    conversationId: string,
    userId: string,
    unreadCount: number,
    lastReadAt: string,
  ): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: conversation_participants - Operation: UPDATE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new UpdateCommand({
      TableName: 'conversation_participants',
      Key: {
        conversationId,
        userId,
      },
      UpdateExpression:
        'SET unreadCount = :unreadCount, lastReadAt = :lastReadAt',
      ExpressionAttributeValues: {
        ':unreadCount': unreadCount,
        ':lastReadAt': lastReadAt,
      },
    });
    await this.client.send(command);
  }

  async getUserConversations(userId: string): Promise<any[]> {
    try {
      const command = new QueryCommand({
        TableName: 'conversation_participants',
        IndexName: 'userId-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
      });
      const result = await this.client.send(command);
      const conversations: any[] = [];

      for (const participant of result.Items || []) {
        const conversation = await this.getConversation(
          participant.conversationId,
        );
        if (conversation) {
          conversations.push(conversation);
        }
      }

      return conversations;
    } catch (error) {
      const scanCommand = new ScanCommand({
        TableName: 'conversation_participants',
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
      });
      const result = await this.client.send(scanCommand);
      const conversations: any[] = [];

      for (const participant of result.Items || []) {
        const conversation = await this.getConversation(
          participant.conversationId,
        );
        if (conversation) {
          conversations.push(conversation);
        }
      }

      return conversations;
    }
  }

  async findPrivateConversation(
    userId1: string,
    userId2: string,
  ): Promise<any> {
    try {
      const user1Conversations = await this.getUserConversations(userId1);

      for (const conversation of user1Conversations) {
        if (conversation.type === 'private') {
          const participants = await this.getConversationParticipants(
            conversation.id,
          );
          const participantIds = participants.map((p) => p.userId);

          if (participantIds.includes(userId2) && participantIds.length === 2) {
            return conversation;
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding private conversation:', error);
      return null;
    }
  }

  async getAllConversations(): Promise<any[]> {
    const command = new ScanCommand({
      TableName: 'conversations',
    });
    const result = await this.client.send(command);
    return result.Items || [];
  }

  async deleteConversation(conversationId: string): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: conversations - Operation: DELETE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new DeleteCommand({
      TableName: 'conversations',
      Key: { id: conversationId },
    });
    await this.client.send(command);
  }

  async getAllMessages(): Promise<any[]> {
    const command = new ScanCommand({
      TableName: 'messages',
    });
    const result = await this.client.send(command);
    return result.Items || [];
  }

  async deleteMessage(messageId: string): Promise<void> {
    console.log(
      `📝 DynamoDB Write - Table: messages - Operation: DELETE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    const command = new DeleteCommand({
      TableName: 'messages',
      Key: { id: messageId },
    });
    await this.client.send(command);
  }
}
