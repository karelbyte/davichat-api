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
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

@Injectable()
export class DynamoDBService implements OnModuleInit {
  private readonly client: DynamoDBDocumentClient;
  private readonly dynamoClient: DynamoDBClient;

  constructor(private configService: ConfigService) {
    this.dynamoClient = new DynamoDBClient({
      region: this.configService.get('app.dynamodb.region') || 'us-east-1',
      endpoint: this.configService.get('app.dynamodb.endpoint'),
    });
    this.client = DynamoDBDocumentClient.from(this.dynamoClient);
  }

  async onModuleInit() {
    try {
      await this.createTablesIfNotExist();
    } catch (error) {
      console.error('Error conectando a DynamoDB:', error);
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
      } else {
        console.error(
          `Error verificando tabla ${tableConfig.name}:`,
          error.message,
        );
        throw error;
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
    const currentUser = await this.getUser(userId);
    if (!currentUser) {
      throw new Error('Usuario no encontrado');
    }

    const updatedUser = {
      ...currentUser,
      ...updateData,
      updatedAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: 'users',
      Item: updatedUser,
    });

    await this.client.send(command);
  }

  async updateUserAvatar(userId: string, avatarUrl: string): Promise<void> {
    const command = new UpdateCommand({
      TableName: 'users',
      Key: { id: userId },
      UpdateExpression: 'SET avatar = :avatar, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':avatar': avatarUrl,
        ':updatedAt': new Date().toISOString(),
      },
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

  async updateConversationCreatedBy(
    conversationId: string,
    newCreatedBy: string,
  ): Promise<void> {
    const command = new UpdateCommand({
      TableName: 'conversations',
      Key: { id: conversationId },
      UpdateExpression: 'SET createdBy = :createdBy, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':createdBy': newCreatedBy,
        ':updatedAt': new Date().toISOString(),
      },
    });

    try {
      await this.client.send(command);
    } catch (error) {
      console.error('[DynamoDB] Error al transferir propiedad:', error);
      throw error;
    }
  }

  async deleteConversationMessages(conversationId: string): Promise<number> {
    let totalDeleted = 0;
    let lastEvaluatedKey: any = undefined;

    try {
      do {
        const scanCommand = new ScanCommand({
          TableName: 'messages',
          FilterExpression: 'conversationId = :conversationId',
          ExpressionAttributeValues: {
            ':conversationId': conversationId,
          },
          Limit: 25,
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const result = await this.client.send(scanCommand);
        const items = result.Items || [];
        lastEvaluatedKey = result.LastEvaluatedKey;

        if (items.length > 0) {
          const deleteRequests = items.map((message) => ({
            DeleteRequest: {
              Key: {
                id: message.id,
                conversationId: message.conversationId,
              },
            },
          }));

          const batchWriteCommand = new BatchWriteCommand({
            RequestItems: {
              messages: deleteRequests,
            },
          });

          await this.client.send(batchWriteCommand);
          totalDeleted += items.length;
        }
      } while (lastEvaluatedKey);

      return totalDeleted;
    } catch (error) {
      console.error('[DynamoDB] Error eliminando mensajes:', error);
      throw error;
    }
  }

  async addParticipant(
    conversationId: string,
    userId: string,
    participantData: any,
  ): Promise<void> {
    const existingParticipant = await this.getParticipant(
      conversationId,
      userId,
    );
    if (existingParticipant) {
      const command = new UpdateCommand({
        TableName: 'conversation_participants',
        Key: {
          conversationId,
          userId,
        },
        UpdateExpression:
          'SET unreadCount = :unreadCount, lastReadAt = :lastReadAt, isActive = :isActive, updatedAt = :updatedAt REMOVE deletedAt',
        ExpressionAttributeValues: {
          ':unreadCount': participantData.unreadCount || 0,
          ':lastReadAt': participantData.lastReadAt || new Date().toISOString(),
          ':isActive': true,
          ':updatedAt': new Date().toISOString(),
        },
      });
      await this.client.send(command);
      return;
    }

    const command = new PutCommand({
      TableName: 'conversation_participants',
      Item: {
        conversationId,
        userId,
        ...participantData,
        isActive: true,
        joinedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    try {
      await this.client.send(command);
    } catch (error) {
      console.error('[DynamoDB] Error al crear participante:', error);
      throw error;
    }
  }

  async getParticipant(conversationId: string, userId: string): Promise<any> {
    const command = new GetCommand({
      TableName: 'conversation_participants',
      Key: {
        conversationId,
        userId,
      },
    });

    try {
      const result = await this.client.send(command);
      return result.Item || null;
    } catch (error) {
      return null;
    }
  }

  async getConversationParticipants(conversationId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'conversation_participants',
      KeyConditionExpression: 'conversationId = :conversationId',
      FilterExpression: 'isActive = :isActive OR attribute_not_exists(isActive)',
      ExpressionAttributeValues: {
        ':conversationId': conversationId,
        ':isActive': true,
      },
      ConsistentRead: true,
    });

    try {
      const result = await this.client.send(command);
      const participants = result.Items || [];
      const activeParticipants = participants.filter(
        (p) => p.isActive !== false && !p.deletedAt,
      );
      return activeParticipants;
    } catch (error) {
      console.error('[DynamoDB] Error al obtener participantes:', error);
      return [];
    }
  }

  async removeParticipant(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const command = new UpdateCommand({
      TableName: 'conversation_participants',
      Key: {
        conversationId,
        userId,
      },
      UpdateExpression:
        'SET isActive = :isActive, deletedAt = :deletedAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':isActive': false,
        ':deletedAt': new Date().toISOString(),
        ':updatedAt': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(conversationId)',
    });

    try {
      await this.client.send(command);
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        return;
      }
      console.error(
        `[DynamoDB] Error al marcar participante como inactivo:`,
        error,
      );
      throw error;
    }
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
        FilterExpression: 'isActive = :isActive OR attribute_not_exists(isActive)',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':isActive': true,
        },
      });
      const result = await this.client.send(command);
      const conversations: any[] = [];

      for (const participant of result.Items || []) {
        const conversation = await this.getConversation(
          participant.conversationId,
        );
        if (!conversation) {
          try {
            const deleteCommand = new DeleteCommand({
              TableName: 'conversation_participants',
              Key: {
                conversationId: participant.conversationId,
                userId: participant.userId,
              },
            });
            await this.client.send(deleteCommand);
          } catch (error) {
            // Ignorar errores al limpiar registros huérfanos
          }
          continue;
        }

        const directParticipantCheck = await this.getParticipant(
          conversation.id,
          userId,
        );
        
        const activeParticipants = await this.getConversationParticipants(
          conversation.id,
        );
        const activeParticipantIds = activeParticipants.map((p) => p.userId);

        if (!activeParticipantIds.includes(userId)) {
          try {
            const deleteCommand = new DeleteCommand({
              TableName: 'conversation_participants',
              Key: {
                conversationId: conversation.id,
                userId: userId,
              },
            });
            await this.client.send(deleteCommand);
            await new Promise((resolve) => setTimeout(resolve, 200));
            const verifyDeleted = await this.getParticipant(conversation.id, userId);
            if (verifyDeleted) {
              await new Promise((resolve) => setTimeout(resolve, 300));
              await this.client.send(deleteCommand);
            }
          } catch (error) {
            // Ignorar errores
          }
          continue;
        }

        const updatedConversation = {
          ...conversation,
          participants: activeParticipantIds,
          unreadCount: participant.unreadCount || 0,
          lastReadAt: participant.lastReadAt || null,
        };

        conversations.push(updatedConversation);
      }

      return conversations;
    } catch (error) {
      console.error(
        '[DynamoDB] Error en getUserConversations, usando fallback:',
        error,
      );

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
        if (!conversation) {
          try {
            const deleteCommand = new DeleteCommand({
              TableName: 'conversation_participants',
              Key: {
                conversationId: participant.conversationId,
                userId: participant.userId,
              },
            });
            await this.client.send(deleteCommand);
          } catch (error) {
            // Ignorar errores
          }
          continue;
        }

        const activeParticipants = await this.getConversationParticipants(
          conversation.id,
        );
        const activeParticipantIds = activeParticipants.map((p) => p.userId);

        if (!activeParticipantIds.includes(userId)) {
          try {
            const deleteCommand = new DeleteCommand({
              TableName: 'conversation_participants',
              Key: {
                conversationId: conversation.id,
                userId: userId,
              },
            });
            await this.client.send(deleteCommand);
          } catch (error) {
            // Ignorar errores
          }
          continue;
        }

        const updatedConversation = {
          ...conversation,
          participants: activeParticipantIds,
          unreadCount: participant.unreadCount || 0,
          lastReadAt: participant.lastReadAt || null,
        };

        conversations.push(updatedConversation);
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
    try {
      const scanCommand = new ScanCommand({
        TableName: 'messages',
        FilterExpression: 'id = :messageId',
        ExpressionAttributeValues: {
          ':messageId': messageId,
        },
      });

      const result = await this.client.send(scanCommand);

      if (!result.Items || result.Items.length === 0) {
        throw new Error('Mensaje no encontrado');
      }

      const message = result.Items[0];

      const deleteCommand = new DeleteCommand({
        TableName: 'messages',
        Key: {
          id: messageId,
          conversationId: message.conversationId,
        },
      });
      await this.client.send(deleteCommand);
    } catch (error) {
      console.error('Error eliminando mensaje:', error);
      throw error;
    }
  }

  async getMessage(messageId: string): Promise<any> {
    try {
      const scanCommand = new ScanCommand({
        TableName: 'messages',
        FilterExpression: 'id = :messageId',
        ExpressionAttributeValues: {
          ':messageId': messageId,
        },
      });

      const result = await this.client.send(scanCommand);
      return result.Items && result.Items.length > 0 ? result.Items[0] : null;
    } catch (error) {
      console.error('Error getting message:', error);
      throw error;
    }
  }

  async getMessageByFileUrl(fileUrl: string): Promise<any> {
    try {
      const scanCommand = new ScanCommand({
        TableName: 'messages',
        FilterExpression:
          'contains(content, :fileUrl) AND messageType = :messageType',
        ExpressionAttributeValues: {
          ':fileUrl': fileUrl,
          ':messageType': 'file',
        },
      });

      const result = await this.client.send(scanCommand);
      return result.Items && result.Items.length > 0 ? result.Items[0] : null;
    } catch (error) {
      console.error('Error getting message by file URL:', error);
      throw error;
    }
  }

  async updateMessage(messageId: string, newContent: string): Promise<void> {
    try {
      const scanCommand = new ScanCommand({
        TableName: 'messages',
        FilterExpression: 'id = :messageId',
        ExpressionAttributeValues: {
          ':messageId': messageId,
        },
      });

      const result = await this.client.send(scanCommand);

      if (!result.Items || result.Items.length === 0) {
        throw new Error('Message not found');
      }

      const message = result.Items[0];

      const command = new UpdateCommand({
        TableName: 'messages',
        Key: {
          id: messageId,
          conversationId: message.conversationId,
        },
        UpdateExpression:
          'SET content = :content, isEdited = :isEdited, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':content': newContent,
          ':isEdited': true,
          ':updatedAt': new Date().toISOString(),
        },
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Error updating message:', error);
      throw error;
    }
  }

  async deleteAllMessages(): Promise<number> {
    let totalDeleted = 0;
    let lastEvaluatedKey: any = undefined;

    try {
      do {
        const scanCommand = new ScanCommand({
          TableName: 'messages',
          Limit: 25,
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const result = await this.client.send(scanCommand);
        const items = result.Items || [];
        lastEvaluatedKey = result.LastEvaluatedKey;

        if (items.length > 0) {
          const deleteRequests = items.map((message) => ({
            DeleteRequest: {
              Key: {
                id: message.id,
                conversationId: message.conversationId,
              },
            },
          }));

          const batchWriteCommand = new BatchWriteCommand({
            RequestItems: {
              messages: deleteRequests,
            },
          });

          await this.client.send(batchWriteCommand);
          totalDeleted += items.length;
        }
      } while (lastEvaluatedKey);

      return totalDeleted;
    } catch (error) {
      console.error('Error eliminando mensajes:', error);
      throw error;
    }
  }

  async deleteMessagesInBatches(batchSize: number = 25): Promise<number> {
    let totalDeleted = 0;
    let lastEvaluatedKey: any = undefined;

    try {
      do {
        const scanCommand = new ScanCommand({
          TableName: 'messages',
          Limit: batchSize,
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const result = await this.client.send(scanCommand);
        const items = result.Items || [];
        lastEvaluatedKey = result.LastEvaluatedKey;

        if (items.length > 0) {
          const deleteRequests = items.map((message) => ({
            DeleteRequest: {
              Key: {
                id: message.id,
                conversationId: message.conversationId,
              },
            },
          }));

          const batchWriteCommand = new BatchWriteCommand({
            RequestItems: {
              messages: deleteRequests,
            },
          });

          await this.client.send(batchWriteCommand);
          totalDeleted += items.length;

          if (lastEvaluatedKey) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      } while (lastEvaluatedKey);

      return totalDeleted;
    } catch (error) {
      console.error('Error eliminando mensajes en lotes:', error);
      throw error;
    }
  }
}
