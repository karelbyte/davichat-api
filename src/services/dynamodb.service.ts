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
      credentials: {
        accessKeyId: this.configService.get('app.dynamodb.accessKeyId') || '',
        secretAccessKey: this.configService.get('app.dynamodb.secretAccessKey') || '',
      },
      endpoint: this.configService.get('app.dynamodb.endpoint'),
    });
    this.client = DynamoDBDocumentClient.from(this.dynamoClient);
  }

  async onModuleInit() {
    await this.createTablesIfNotExist();
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
            KeySchema: [
              { AttributeName: 'userId', KeyType: 'HASH' },
            ],
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
      await this.createTableIfNotExists(table);
    }
  }

  private async createTableIfNotExists(tableConfig: any) {
    try {
      await this.dynamoClient.send(
        new DescribeTableCommand({ TableName: tableConfig.name }),
      );
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        const createCommand = new CreateTableCommand({
          TableName: tableConfig.name,
          KeySchema: tableConfig.keySchema,
          AttributeDefinitions: tableConfig.attributeDefinitions,
          GlobalSecondaryIndexes: tableConfig.globalSecondaryIndexes,
          BillingMode: 'PAY_PER_REQUEST',
        });
        await this.dynamoClient.send(createCommand);
      }
    }
  }

  async createUser(userData: any): Promise<void> {
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
    const command = new UpdateCommand({
      TableName: 'conversation_participants',
      Key: {
        conversationId,
        userId,
      },
      UpdateExpression: 'SET unreadCount = :unreadCount, lastReadAt = :lastReadAt',
      ExpressionAttributeValues: {
        ':unreadCount': unreadCount,
        ':lastReadAt': lastReadAt,
      },
    });
    await this.client.send(command);
  }

  async getUserConversations(userId: string): Promise<any[]> {
    try {
      // Try to use GSI first
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
        const conversation = await this.getConversation(participant.conversationId);
        if (conversation) {
          conversations.push(conversation);
        }
      }
      
      return conversations;
    } catch (error) {
      // If GSI doesn't exist, use Scan as fallback
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
        const conversation = await this.getConversation(participant.conversationId);
        if (conversation) {
          conversations.push(conversation);
        }
      }
      
      return conversations;
    }
  }

  async findPrivateConversation(userId1: string, userId2: string): Promise<any> {
    try {
      // Get all conversations for user1
      const user1Conversations = await this.getUserConversations(userId1);
      
      // Find private conversation with user2
      for (const conversation of user1Conversations) {
        if (conversation.type === 'private') {
          const participants = await this.getConversationParticipants(conversation.id);
          const participantIds = participants.map(p => p.userId);
          
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
}
