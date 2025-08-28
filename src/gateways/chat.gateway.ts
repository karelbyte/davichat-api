import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../services/redis.service';
import { DynamoDBService } from '../services/dynamodb.service';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { FileStorageService } from '../services/file-storage.service';

@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly redisService: RedisService,
    private readonly dynamoDBService: DynamoDBService,
    private readonly configService: ConfigService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async handleConnection(client: Socket) {
    const userId = client.handshake.auth.userId;
    if (userId) {
      await this.redisService.setUserOnline(userId);
      client.join(`user:${userId}`);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.handshake.auth.userId;
    if (userId) {
      await this.redisService.setUserOffline(userId);
      this.server.emit('user_status_update', { userId, status: 'offline' });
    }
  }

  @SubscribeMessage('user_join')
  async handleUserJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; name?: string; email?: string },
  ) {
    const { userId, name, email } = data;
    await this.redisService.setUserOnline(userId);
    await this.redisService.setUser(userId, { userId, name, email });
    client.join(`user:${userId}`);

    this.server.emit('user_status_update', { userId, status: 'online' });

    this.server.emit('user_connected', {
      userId,
      name,
      email,
      status: 'online',
    });
  }

  @SubscribeMessage('user_leave')
  async handleUserLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const userId = data.userId;
    await this.redisService.setUserOffline(userId);
    client.leave(`user:${userId}`);
    this.server.emit('user_status_update', { userId, status: 'offline' });
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const { conversationId, userId } = data;
    client.join(`conversation:${conversationId}`);
    this.server.to(`conversation:${conversationId}`).emit('user_joined', {
      conversationId,
      userId,
    });
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const { conversationId, userId } = data;
    client.leave(`conversation:${conversationId}`);
    this.server.to(`conversation:${conversationId}`).emit('user_left', {
      conversationId,
      userId,
    });
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      conversationId: string;
      senderId: string;
      content: string;
      messageType: string;
    },
  ) {
    const { conversationId, senderId, content, messageType } = data;
    const messageId = uuidv4();
    const timestamp = new Date().toISOString();

    const messageData = {
      id: messageId,
      conversationId,
      senderId,
      content,
      messageType,
      timestamp,
      isEdited: false,
      isDeleted: false,
    };

    await this.dynamoDBService.createMessage(messageData);

    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    const participants =
      await this.dynamoDBService.getConversationParticipants(conversationId);

    this.server
      .to(`conversation:${conversationId}`)
      .emit('message_received', messageData);

    const onlineUsers = await this.redisService.getOnlineUsers();

    for (const participant of participants) {
      if (participant.userId === senderId) continue;

      const isOnline = onlineUsers.includes(participant.userId);

      if (isOnline) {
        const unreadEvent = {
          type: conversation.type,
          conversationId,
          senderId,
          messageId,
          content,
          timestamp,
        };

        this.server
          .to(`user:${participant.userId}`)
          .emit(
            conversation.type === 'private'
              ? 'unread_message_private'
              : 'unread_message_group',
            unreadEvent,
          );
      }
    }
  }

  @SubscribeMessage('typing_start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const { conversationId, userId } = data;
    this.server.to(`conversation:${conversationId}`).emit('typing_indicator', {
      conversationId,
      userId,
      isTyping: true,
    });
  }

  @SubscribeMessage('typing_stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const { conversationId, userId } = data;
    this.server.to(`conversation:${conversationId}`).emit('typing_indicator', {
      conversationId,
      userId,
      isTyping: false,
    });
  }

  @SubscribeMessage('user_status')
  async handleUserStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; status: string },
  ) {
    const { userId, status } = data;
    await this.redisService.setUser(userId, { status });
    this.server.emit('user_status_update', { userId, status });
  }

  @SubscribeMessage('mark_messages_as_read')
  async handleMarkMessagesAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const { conversationId, userId } = data;

    await this.dynamoDBService.updateParticipantReadStatus(
      conversationId,
      userId,
      0,
      new Date().toISOString(),
    );

    this.server.to(`user:${userId}`).emit('messages_marked_as_read', {
      conversationId,
      userId,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('create_group')
  async handleCreateGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      name: string;
      description?: string;
      participants: string[];
      createdBy: string;
    },
  ) {
    const conversationId = uuidv4();
    const conversationData = {
      id: conversationId,
      type: 'group',
      name: data.name,
      description: data.description,
      participants: data.participants,
      createdBy: data.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.dynamoDBService.createConversation(conversationData);

    for (const userId of data.participants) {
      await this.dynamoDBService.addParticipant(conversationId, userId, {
        unreadCount: 0,
        lastReadAt: new Date().toISOString(),
        isActive: true,
      });
    }

    this.server.emit('group_created', conversationData);
  }

  @SubscribeMessage('add_user_to_group')
  async handleAddUserToGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { conversationId: string; userId: string; addedBy: string },
  ) {
    const { conversationId, userId, addedBy } = data;

    // ✅ OBTENER: Información de la conversación primero
    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      return;
    }

    // ✅ VERIFICAR: Participantes ANTES de añadir

    const participantsBefore =
      await this.dynamoDBService.getConversationParticipants(conversationId);

    // Añadir participante a la base de datos

    await this.dynamoDBService.addParticipant(conversationId, userId, {
      unreadCount: 0,
      lastReadAt: new Date().toISOString(),
      isActive: true,
    });

    // ✅ VERIFICAR: Participantes DESPUÉS de añadir

    const participantsAfter =
      await this.dynamoDBService.getConversationParticipants(conversationId);

    // ✅ VERIFICAR: Cambio en el número de participantes
    const participantCountChange =
      participantsAfter.length - participantsBefore.length;

    if (participantCountChange !== 1) {
      // Verificar si el usuario ya existía
      const wasAlreadyParticipant = participantsBefore.some(
        (p) => p.userId === userId,
      );
      if (wasAlreadyParticipant) {
        console.log('⚠️ [WebSocket] El usuario ya era participante del grupo');
      }
    }

    // ✅ NUEVO: Obtener participantes actualizados para el evento
    const updatedParticipants =
      await this.dynamoDBService.getConversationParticipants(conversationId);
    const updatedParticipantIds = updatedParticipants.map((p) => p.userId);
    const participantCount = updatedParticipantIds.length;

    console.log(
      '👥 [WebSocket] Participantes finales para el evento:',
      updatedParticipantIds,
    );
    console.log(
      '🔢 [WebSocket] Conteo final de participantes:',
      participantCount,
    );

    // ✅ SOLUCIÓN: Emitir evento con datos completos a todos en el grupo
    console.log(
      '📢 [WebSocket] Emitiendo evento user_added_to_group a todos en el grupo...',
    );
    console.log(
      '📢 [WebSocket] Room objetivo:',
      `conversation:${conversationId}`,
    );

    // ✅ VERIFICAR: Status del room antes de emitir
    const room = this.server.sockets.adapter.rooms.get(
      `conversation:${conversationId}`,
    );
    const usersInRoom = room ? room.size : 0;
    console.log(
      '👥 [WebSocket] Usuarios en el room ANTES de emitir:',
      usersInRoom,
    );

    // ✅ NUEVO: Evento con datos completos como sugiere el frontend
    const eventData = {
      conversationId,
      conversationName: conversation.name,
      userId,
      addedBy,
      updatedParticipants: updatedParticipantIds, // Lista completa actualizada
      participantCount, // Conteo actualizado
      timestamp: new Date().toISOString(),
    };

    // ✅ SOLUCIÓN 1: Emitir al room del grupo (para usuarios que ya están en el room)
    console.log(
      '📢 [WebSocket] Emitiendo evento user_added_to_group al room del grupo...',
    );
    const emitResult = this.server
      .to(`conversation:${conversationId}`)
      .emit('user_added_to_group', eventData);
    console.log(
      '✅ [WebSocket] Evento user_added_to_group emitido al room. Resultado:',
      emitResult,
    );
    console.log('📊 [WebSocket] Datos del evento enviados al room:', eventData);

    // ✅ SOLUCIÓN 2: Emitir a cada participante individualmente (GARANTIZA que todos reciban)
    console.log(
      '📢 [WebSocket] Emitiendo evento user_added_to_group a cada participante individualmente...',
    );

    for (const participant of updatedParticipants) {
      const participantUserId = participant.userId;
      console.log(
        `📢 [WebSocket] Enviando evento a participante: ${participantUserId}`,
      );

      const emitResultIndividual = this.server
        .to(`user:${participantUserId}`)
        .emit('user_added_to_group', eventData);
      console.log(
        `✅ [WebSocket] Evento enviado a ${participantUserId}. Resultado:`,
        emitResultIndividual,
      );
    }

    // ✅ SOLUCIÓN 3: Emitir también al usuario específico que se añadió (por si no está en ningún room)
    console.log(
      '📢 [WebSocket] Emitiendo evento user_added_to_group al usuario añadido específicamente...',
    );
    const emitResultSpecific = this.server
      .to(`user:${userId}`)
      .emit('user_added_to_group', eventData);
    console.log(
      '✅ [WebSocket] Evento user_added_to_group emitido al usuario añadido. Resultado:',
      emitResultSpecific,
    );

    // ✅ VERIFICAR: Status del room después de emitir
    const roomAfter = this.server.sockets.adapter.rooms.get(
      `conversation:${conversationId}`,
    );
    const usersInRoomAfter = roomAfter ? roomAfter.size : 0;
    console.log(
      '👥 [WebSocket] Usuarios en el room DESPUÉS de emitir:',
      usersInRoomAfter,
    );

    console.log('🎉 [WebSocket] Proceso de añadir usuario al grupo completado');
    console.log('📋 [WebSocket] RESUMEN FINAL:', {
      conversationId,
      conversationName: conversation.name,
      userId,
      addedBy,
      participantsBefore: participantsBefore.length,
      participantsAfter: participantsAfter.length,
      participantCountChange,
      finalParticipantCount: participantCount,
      usersInRoomBefore: usersInRoom,
      usersInRoomAfter: usersInRoomAfter,
      totalParticipants: updatedParticipants.length,
    });

    // ✅ NUEVO: Emitir también group_participants_updated para actualización masiva
    console.log(
      '📢 [WebSocket] Emitiendo evento group_participants_updated para actualización masiva...',
    );
    const groupUpdateEventData = {
      conversationId,
      conversationName: conversation.name,
      participants: updatedParticipantIds,
      participantCount,
      updatedAt: new Date().toISOString(),
      action: 'add' as const,
      affectedUsers: [userId],
      updatedBy: addedBy,
    };

    // ✅ Emitir group_participants_updated a todos los participantes
    for (const participant of updatedParticipants) {
      const participantUserId = participant.userId;
      console.log(
        `📢 [WebSocket] Enviando group_participants_updated a: ${participantUserId}`,
      );

      const emitResultGroup = this.server
        .to(`user:${participantUserId}`)
        .emit('group_participants_updated', groupUpdateEventData);
      console.log(
        `✅ [WebSocket] group_participants_updated enviado a ${participantUserId}. Resultado:`,
        emitResultGroup,
      );
    }

    // ✅ Emitir también al room del grupo
    const emitResultGroupRoom = this.server
      .to(`conversation:${conversationId}`)
      .emit('group_participants_updated', groupUpdateEventData);
    console.log(
      '✅ [WebSocket] group_participants_updated enviado al room. Resultado:',
      emitResultGroupRoom,
    );

    console.log(
      '🎉 [WebSocket] Proceso completo de añadir usuario al grupo terminado',
    );
  }

  @SubscribeMessage('group_participants_updated')
  async handleGroupParticipantsUpdated(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      conversationId: string;
      action: 'add' | 'remove' | 'bulk_update';
      affectedUsers: string[];
      updatedBy: string;
    },
  ) {
    const { conversationId, action, affectedUsers, updatedBy } = data;

    // ✅ OBTENER: Información de la conversación
    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      return;
    }

    // ✅ OBTENER: Participantes actualizados
    const updatedParticipants =
      await this.dynamoDBService.getConversationParticipants(conversationId);
    const updatedParticipantIds = updatedParticipants.map((p) => p.userId);
    const participantCount = updatedParticipantIds.length;

    // ✅ EMITIR: Evento group_participants_updated a todos los participantes
    const eventData = {
      conversationId,
      conversationName: conversation.name,
      participants: updatedParticipantIds,
      participantCount,
      updatedAt: new Date().toISOString(),
      action,
      affectedUsers,
      updatedBy,
    };

    // ✅ SOLUCIÓN: Emitir a cada participante individualmente
    for (const participant of updatedParticipants) {
      const participantUserId = participant.userId;
      this.server
        .to(`user:${participantUserId}`)
        .emit('group_participants_updated', eventData);
    }

    // ✅ SOLUCIÓN: Emitir también al room del grupo
    this.server
      .to(`conversation:${conversationId}`)
      .emit('group_participants_updated', eventData);
  }

  @SubscribeMessage('edit_message')
  async handleEditMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { messageId: string; newContent: string; userId: string },
  ) {
    try {
      const { messageId, newContent, userId } = data;

      const message = await this.dynamoDBService.getMessage(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      if (message.senderId !== userId) {
        throw new Error('Unauthorized to edit this message');
      }

      if (message.messageType !== 'text') {
        throw new Error('Only text messages can be edited');
      }

      const timeDiff = Date.now() - new Date(message.timestamp).getTime();
      const fifteenMinutes = 15 * 60 * 1000;
      if (timeDiff > fifteenMinutes) {
        throw new Error('Message can only be edited within 15 minutes');
      }

      await this.dynamoDBService.updateMessage(messageId, newContent);

      const updatedMessage = await this.dynamoDBService.getMessage(messageId);

      this.server
        .to(`conversation:${message.conversationId}`)
        .emit('message_edited', updatedMessage);
    } catch (error) {
      console.error('Error editing message:', error);
      client.emit('edit_message_error', { error: error.message });
    }
  }

  @SubscribeMessage('delete_message')
  async handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; userId: string },
  ) {
    try {
      const { messageId, userId } = data;

      const message = await this.dynamoDBService.getMessage(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      if (message.senderId !== userId) {
        throw new Error('Unauthorized to delete this message');
      }

      if (message.messageType === 'file') {
        try {
          const fileData = JSON.parse(message.content);
          await this.fileStorageService.deleteFile(fileData.fileUrl);
        } catch (fileError) {
          console.error('Error deleting file:', fileError);
        }
      }

      await this.dynamoDBService.deleteMessage(messageId);

      this.server
        .to(`conversation:${message.conversationId}`)
        .emit('message_deleted', {
          messageId,
          conversationId: message.conversationId,
        });
    } catch (error) {
      console.error('Error deleting message:', error);
      client.emit('delete_message_error', { error: error.message });
    }
  }

  @SubscribeMessage('send_reply')
  async handleSendReply(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      conversationId: string;
      senderId: string;
      content: string;
      messageType: string;
      replyTo: string;
    },
  ) {
    try {
      const { conversationId, senderId, content, messageType, replyTo } = data;

      // 1. Validar que el usuario esté en la conversación
      const participants = await this.dynamoDBService.getConversationParticipants(conversationId);
      const isUserInConversation = participants.some(p => p.userId === senderId);
      
      if (!isUserInConversation) {
        client.emit('reply_error', { error: 'Usuario no está en la conversación' });
        return;
      }

      // 2. Validar que el mensaje original existe
      const originalMessage = await this.dynamoDBService.getMessage(replyTo);
      if (!originalMessage || originalMessage.conversationId !== conversationId) {
        client.emit('reply_error', { error: 'Mensaje original no encontrado' });
        return;
      }

      // 3. Crear el mensaje de respuesta
      const messageId = uuidv4();
      const timestamp = new Date().toISOString();
      
      const replyMessageData = {
        id: messageId,
        conversationId,
        senderId,
        content,
        messageType,
        timestamp,
        isEdited: false,
        isDeleted: false,
        replyTo,
        isReply: true
      };

      await this.dynamoDBService.createMessage(replyMessageData);

      // 4. Generar replyPreview del mensaje original
      let replyPreview = originalMessage.content;
      if (originalMessage.messageType === 'file' || originalMessage.messageType === 'audio') {
        try {
          const fileData = JSON.parse(originalMessage.content);
          const fileType = originalMessage.messageType === 'audio' ? 'Audio' : 'Archivo';
          replyPreview = `${fileType}: ${fileData.fileName || 'Sin nombre'}`;
        } catch {
          replyPreview = originalMessage.messageType === 'audio' ? 'Audio' : 'Archivo';
        }
      }

      // Truncar si es muy largo
      if (replyPreview.length > 100) {
        replyPreview = replyPreview.substring(0, 97) + '...';
      }

      // 5. Obtener información del usuario remitente
      const user = await this.dynamoDBService.getUser(senderId);
      const senderInfo = {
        id: senderId,
        name: user?.name || 'Usuario',
        avatar: user?.avatar || ''
      };

      // 6. Emitir evento reply_received a todos en la conversación
      const eventData = {
        ...replyMessageData,
        replyPreview,
        sender: senderInfo
      };

      this.server
        .to(`conversation:${conversationId}`)
        .emit('reply_received', eventData);

      // 7. Confirmar envío exitoso al remitente
      client.emit('reply_sent_success', {
        messageId,
        conversationId,
        timestamp
      });

    } catch (error) {
      console.error('Error processing reply:', error);
      client.emit('reply_error', { error: 'Error interno del servidor' });
    }
  }
}
