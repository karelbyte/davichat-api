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
      /*...(this.configService.get('app.nodeEnv') !== 'production'
        ? {
            credentials: {
              accessKeyId:
                this.configService.get('app.dynamodb.accessKeyId') || '',
              secretAccessKey:
                this.configService.get('app.dynamodb.secretAccessKey') || '',
            },
          }
        : {}),*/
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
    
    // Obtener el usuario actual primero
    const currentUser = await this.getUser(userId);
    if (!currentUser) {
      throw new Error('Usuario no encontrado');
    }
    
    // Crear el item actualizado manteniendo todos los campos existentes
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
    console.log(
      `📝 DynamoDB Write - Table: users - Operation: UPDATE_AVATAR - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
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
      `📝 [DynamoDB] Añadiendo participante - Table: conversation_participants - Operation: CREATE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    console.log('👤 [DynamoDB] Detalles del participante:', {
      conversationId,
      userId,
      participantData,
    });

    // ✅ VERIFICAR: Si el participante ya existe
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
          'SET unreadCount = :unreadCount, lastReadAt = :lastReadAt, isActive = :isActive, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':unreadCount': participantData.unreadCount || 0,
          ':lastReadAt': participantData.lastReadAt || new Date().toISOString(),
          ':isActive':
            participantData.isActive !== undefined
              ? participantData.isActive
              : true,
          ':updatedAt': new Date().toISOString(),
        },
      });
      await this.client.send(command);
      console.log(
        '✅ [DynamoDB] Participante existente actualizado exitosamente',
      );
      return;
    }

    console.log('🆕 [DynamoDB] Creando nuevo participante...');
    const command = new PutCommand({
      TableName: 'conversation_participants',
      Item: {
        conversationId,
        userId,
        ...participantData,
        joinedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    try {
      await this.client.send(command);
      console.log('✅ [DynamoDB] Nuevo participante creado exitosamente');
    } catch (error) {
      console.error('💥 [DynamoDB] Error al crear participante:', error);
      throw error;
    }
  }

  async getParticipant(conversationId: string, userId: string): Promise<any> {
    console.log('🔍 [DynamoDB] Verificando si el participante existe:', {
      conversationId,
      userId,
    });

    const command = new GetCommand({
      TableName: 'conversation_participants',
      Key: {
        conversationId,
        userId,
      },
    });

    try {
      const result = await this.client.send(command);
      const exists = !!result.Item;
      console.log(
        '🔍 [DynamoDB] Participante existe:',
        exists,
        result.Item ? 'Sí' : 'No',
      );
      return result.Item || null;
    } catch (error) {
      console.error('💥 [DynamoDB] Error al verificar participante:', error);
      return null;
    }
  }

  async getConversationParticipants(conversationId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'conversation_participants',
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': conversationId,
      },
    });

    try {
      const result = await this.client.send(command);
      const participants = result.Items || [];
      return participants;
    } catch (error) {
      console.error('💥 [DynamoDB] Error al obtener participantes:', error);
      return [];
    }
  }

  async removeParticipant(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    console.log(
      `📝 [DynamoDB] Removiendo participante - Table: conversation_participants - Operation: DELETE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );
    console.log('👤 [DynamoDB] Detalles del participante a remover:', {
      conversationId,
      userId,
    });

    // Verificar que el participante existe
    const existingParticipant = await this.getParticipant(conversationId, userId);
    if (!existingParticipant) {
      console.log(
        '⚠️ [DynamoDB] El participante no existe en la conversación',
      );
      throw new Error('Participante no encontrado en la conversación');
    }

    const command = new DeleteCommand({
      TableName: 'conversation_participants',
      Key: {
        conversationId,
        userId,
      },
    });

    try {
      await this.client.send(command);
      console.log(
        '✅ [DynamoDB] Participante removido exitosamente de la conversación',
      );
    } catch (error) {
      console.error('💥 [DynamoDB] Error al remover participante:', error);
      throw error;
    }
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
          const activeParticipants = await this.getConversationParticipants(
            conversation.id,
          );
          const activeParticipantIds = activeParticipants.map((p) => p.userId);
          const updatedConversation = {
            ...conversation,
            participants: activeParticipantIds, // ← Usar participantes activos
            unreadCount: participant.unreadCount || 0, // ← Contador de no leídos
            lastReadAt: participant.lastReadAt || null, // ← Última vez que leyó
          };

          conversations.push(updatedConversation);
        }
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
        if (conversation) {
          const activeParticipants = await this.getConversationParticipants(
            conversation.id,
          );
          const activeParticipantIds = activeParticipants.map((p) => p.userId);

          // ✅ INCLUIR: unreadCount y lastReadAt del participante actual
          const updatedConversation = {
            ...conversation,
            participants: activeParticipantIds, // ← Usar participantes activos
            unreadCount: participant.unreadCount || 0, // ← Contador de no leídos
            lastReadAt: participant.lastReadAt || null, // ← Última vez que leyó
          };

          conversations.push(updatedConversation);
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

    try {
      // Usar ScanCommand para encontrar el mensaje por id
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

      // Eliminar usando ambas claves
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
        FilterExpression: 'contains(content, :fileUrl) AND messageType = :messageType',
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
    console.log(
      `📝 DynamoDB Write - Table: messages - Operation: BATCH_DELETE - Region: ${this.configService.get('app.dynamodb.region')}`,
    );

    let totalDeleted = 0;
    let lastEvaluatedKey: any = undefined;

    try {
      do {
        // Escanear mensajes en lotes
        const scanCommand = new ScanCommand({
          TableName: 'messages',
          Limit: 25, // Límite de DynamoDB para BatchWrite
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const result = await this.client.send(scanCommand);
        const items = result.Items || [];
        lastEvaluatedKey = result.LastEvaluatedKey;

        if (items.length > 0) {
          // Crear requests de eliminación para este lote
          const deleteRequests = items.map((message) => ({
            DeleteRequest: {
              Key: {
                id: message.id,
                conversationId: message.conversationId,
              },
            },
          }));

          // Ejecutar eliminación en lote
          const batchWriteCommand = new BatchWriteCommand({
            RequestItems: {
              messages: deleteRequests,
            },
          });

          await this.client.send(batchWriteCommand);
          totalDeleted += items.length;
          console.log(
            `✅ Lote eliminado: ${items.length} mensajes. Total: ${totalDeleted}`,
          );
        }
      } while (lastEvaluatedKey);

      console.log(
        `🎉 Eliminación completada. Total de mensajes eliminados: ${totalDeleted}`,
      );
      return totalDeleted;
    } catch (error) {
      console.error('Error eliminando mensajes:', error);
      throw error;
    }
  }

  async deleteMessagesInBatches(batchSize: number = 25): Promise<number> {
    console.log(
      `📝 DynamoDB Write - Table: messages - Operation: BATCH_DELETE_BY_BATCHES - Region: ${this.configService.get('app.dynamodb.region')}`,
    );

    let totalDeleted = 0;
    let lastEvaluatedKey: any = undefined;

    try {
      do {
        // Escanear mensajes en lotes del tamaño especificado
        const scanCommand = new ScanCommand({
          TableName: 'messages',
          Limit: batchSize,
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const result = await this.client.send(scanCommand);
        const items = result.Items || [];
        lastEvaluatedKey = result.LastEvaluatedKey;

        if (items.length > 0) {
          // Crear requests de eliminación para este lote
          const deleteRequests = items.map((message) => ({
            DeleteRequest: {
              Key: {
                id: message.id,
                conversationId: message.conversationId,
              },
            },
          }));

          // Ejecutar eliminación en lote
          const batchWriteCommand = new BatchWriteCommand({
            RequestItems: {
              messages: deleteRequests,
            },
          });

          await this.client.send(batchWriteCommand);
          totalDeleted += items.length;
          console.log(
            `✅ Lote eliminado: ${items.length} mensajes. Total: ${totalDeleted}`,
          );

          // Pequeña pausa entre lotes para evitar throttling
          if (lastEvaluatedKey) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      } while (lastEvaluatedKey);

      console.log(
        `🎉 Eliminación completada. Total de mensajes eliminados: ${totalDeleted}`,
      );
      return totalDeleted;
    } catch (error) {
      console.error('Error eliminando mensajes en lotes:', error);
      throw error;
    }
  }
}
