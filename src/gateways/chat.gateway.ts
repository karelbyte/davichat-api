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
      } else {
        // ✅ Usuario offline: incrementar unreadCount en la base de datos
        const currentUnreadCount = participant.unreadCount || 0;
        await this.dynamoDBService.updateParticipantReadStatus(
          conversationId,
          participant.userId,
          currentUnreadCount + 1,
          participant.lastReadAt || new Date(0).toISOString(),
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

    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      return;
    }

    const participantsBefore =
      await this.dynamoDBService.getConversationParticipants(conversationId);

    await this.dynamoDBService.addParticipant(conversationId, userId, {
      unreadCount: 0,
      lastReadAt: new Date().toISOString(),
      isActive: true,
    });

    const participantsAfter =
      await this.dynamoDBService.getConversationParticipants(conversationId);

    const participantCountChange =
      participantsAfter.length - participantsBefore.length;

    if (participantCountChange !== 1) {
      const wasAlreadyParticipant = participantsBefore.some(
        (p) => p.userId === userId,
      );
      if (wasAlreadyParticipant) {
        console.log('⚠️ [WebSocket] El usuario ya era participante del grupo');
      }
    }

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

    console.log(
      '📢 [WebSocket] Emitiendo evento user_added_to_group a todos en el grupo...',
    );
    console.log(
      '📢 [WebSocket] Room objetivo:',
      `conversation:${conversationId}`,
    );

    const room = this.server.sockets.adapter.rooms.get(
      `conversation:${conversationId}`,
    );
    const usersInRoom = room ? room.size : 0;
    console.log(
      '👥 [WebSocket] Usuarios en el room ANTES de emitir:',
      usersInRoom,
    );

    const eventData = {
      conversationId,
      conversationName: conversation.name,
      userId,
      addedBy,
      updatedParticipants: updatedParticipantIds,
      participantCount,
      timestamp: new Date().toISOString(),
    };

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

  @SubscribeMessage('leave_group')
  async handleLeaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { conversationId: string; userId: string },
  ) {
    const { conversationId, userId } = data;

    console.log(
      '🚪 [WebSocket] Usuario intentando salir del grupo:',
      { conversationId, userId },
    );

    // Verificar que la conversación existe
    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      console.log('❌ [WebSocket] Conversación no encontrada');
      client.emit('leave_group_error', {
        error: 'Conversación no encontrada',
      });
      return;
    }

    // Verificar que es un grupo
    if (conversation.type !== 'group') {
      console.log('❌ [WebSocket] No es una conversación de grupo');
      client.emit('leave_group_error', {
        error: 'Solo puedes salir de grupos',
      });
      return;
    }

    // Obtener participantes antes de remover
    const participantsBefore =
      await this.dynamoDBService.getConversationParticipants(conversationId);

    // Verificar que el usuario es participante
    const isParticipant = participantsBefore.some((p) => p.userId === userId);
    if (!isParticipant) {
      console.log('❌ [WebSocket] El usuario no es participante del grupo');
      client.emit('leave_group_error', {
        error: 'No eres participante de este grupo',
      });
      return;
    }

    // Verificar si el usuario que sale es el creador del grupo
    const isCreator = conversation.createdBy === userId;
    let newCreatorId: string | null = null;

    // Si el creador sale, transferir propiedad a otro participante
    if (isCreator && participantsBefore.length > 1) {
      // Buscar otro participante (excluyendo al que sale)
      const otherParticipant = participantsBefore.find(
        (p) => p.userId !== userId,
      );
      if (otherParticipant?.userId) {
        newCreatorId = otherParticipant.userId;
        await this.dynamoDBService.updateConversationCreatedBy(
          conversationId,
          otherParticipant.userId,
        );
        console.log(
          `👑 [WebSocket] Propiedad del grupo transferida de ${userId} a ${otherParticipant.userId}`,
        );
      }
    }

    // Remover participante de la base de datos
    try {
      await this.dynamoDBService.removeParticipant(conversationId, userId);
      console.log('✅ [WebSocket] Participante removido de la base de datos');
    } catch (error) {
      console.error('❌ [WebSocket] Error al remover participante:', error);
      client.emit('leave_group_error', {
        error: 'Error al salir del grupo',
      });
      return;
    }

    // Obtener participantes después de remover
    const participantsAfter =
      await this.dynamoDBService.getConversationParticipants(conversationId);
    const updatedParticipantIds = participantsAfter.map((p) => p.userId);
    const participantCount = updatedParticipantIds.length;

    // Si no quedan participantes, eliminar el grupo completo y su historial
    if (participantCount === 0) {
      console.log(
        '🗑️ [WebSocket] Grupo quedó vacío, eliminando grupo y su historial...',
      );

      try {
        // Eliminar todos los mensajes del grupo
        const deletedMessagesCount =
          await this.dynamoDBService.deleteConversationMessages(
            conversationId,
          );
        console.log(
          `✅ [WebSocket] ${deletedMessagesCount} mensajes eliminados del grupo`,
        );

        // Eliminar la conversación
        await this.dynamoDBService.deleteConversation(conversationId);
        console.log('✅ [WebSocket] Grupo eliminado completamente');

        // Notificar al usuario que salió que el grupo fue eliminado
        client.emit('leave_group_success', {
          conversationId,
          conversationName: conversation.name,
          timestamp: new Date().toISOString(),
          groupDeleted: true,
          deletedMessagesCount,
        });

        // Notificar a todos los usuarios conectados que el grupo fue eliminado
        this.server.emit('group_deleted', {
          conversationId,
          conversationName: conversation.name,
          timestamp: new Date().toISOString(),
        });

        console.log('🎉 [WebSocket] Proceso de eliminación de grupo completado');
        return;
      } catch (error) {
        console.error(
          '❌ [WebSocket] Error al eliminar grupo vacío:',
          error,
        );
        // Continuar con el flujo normal aunque falle la eliminación
      }
    }

    // Salir del room de WebSocket
    client.leave(`conversation:${conversationId}`);

    // Obtener información del usuario que salió
    const user = await this.dynamoDBService.getUser(userId);
    const userName = user?.name || 'Usuario';

    console.log(
      '👥 [WebSocket] Participantes después de salir:',
      updatedParticipantIds,
    );
    console.log(
      '🔢 [WebSocket] Conteo final de participantes:',
      participantCount,
    );

    // Evento para el usuario que salió
    const leaveEventData = {
      conversationId,
      conversationName: conversation.name,
      userId,
      userName,
      timestamp: new Date().toISOString(),
    };

    console.log(
      '📢 [WebSocket] Emitiendo evento user_left_group al usuario que salió...',
    );
    this.server.to(`user:${userId}`).emit('user_left_group', leaveEventData);
    this.server.to(`user:${userId}`).emit('group_left', leaveEventData);

    // Evento para los demás participantes del grupo
    const groupUpdateEventData = {
      conversationId,
      conversationName: conversation.name,
      participants: updatedParticipantIds,
      participantCount,
      updatedAt: new Date().toISOString(),
      action: 'remove' as const,
      affectedUsers: [userId],
      updatedBy: userId,
      leftBy: userName,
      ownershipTransferred: isCreator && newCreatorId ? true : false,
      newOwnerId: newCreatorId || undefined,
    };

    console.log(
      '📢 [WebSocket] Emitiendo eventos a los demás participantes del grupo...',
    );

    // Si se transfirió la propiedad, obtener información del nuevo propietario
    let newOwnerName: string | undefined = undefined;
    if (isCreator && newCreatorId) {
      const newOwner = await this.dynamoDBService.getUser(newCreatorId);
      newOwnerName = newOwner?.name || 'Usuario';
      console.log(
        `👑 [WebSocket] Nuevo propietario del grupo: ${newOwnerName} (${newCreatorId})`,
      );
    }

    // Emitir a cada participante restante individualmente
    for (const participant of participantsAfter) {
      const participantUserId = participant.userId;
      console.log(
        `📢 [WebSocket] Enviando eventos a participante: ${participantUserId}`,
      );

      // Evento específico de que un usuario salió
      this.server
        .to(`user:${participantUserId}`)
        .emit('user_left_group', {
          ...leaveEventData,
          leftBy: userName,
          ownershipTransferred: isCreator && newCreatorId ? true : false,
          newOwnerId: newCreatorId || undefined,
          newOwnerName: newOwnerName,
        });

      // Evento de actualización de participantes
      this.server
        .to(`user:${participantUserId}`)
        .emit('group_participants_updated', {
          ...groupUpdateEventData,
          newOwnerName: newOwnerName,
        });
    }

    // Emitir al room del grupo (para usuarios conectados)
    this.server
      .to(`conversation:${conversationId}`)
      .emit('user_left_group', {
        ...leaveEventData,
        leftBy: userName,
        ownershipTransferred: isCreator && newCreatorId ? true : false,
        newOwnerId: newCreatorId || undefined,
        newOwnerName: newOwnerName,
      });
    this.server
      .to(`conversation:${conversationId}`)
      .emit('group_participants_updated', {
        ...groupUpdateEventData,
        newOwnerName: newOwnerName,
      });

    console.log('🎉 [WebSocket] Proceso de salir del grupo completado');
    console.log('📋 [WebSocket] RESUMEN FINAL:', {
      conversationId,
      conversationName: conversation.name,
      userId,
      userName,
      participantsBefore: participantsBefore.length,
      participantsAfter: participantsAfter.length,
      finalParticipantCount: participantCount,
    });

    // Confirmar al cliente que salió exitosamente
    client.emit('leave_group_success', {
      conversationId,
      conversationName: conversation.name,
      timestamp: new Date().toISOString(),
    });
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

    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      return;
    }

    const updatedParticipants =
      await this.dynamoDBService.getConversationParticipants(conversationId);
    const updatedParticipantIds = updatedParticipants.map((p) => p.userId);
    const participantCount = updatedParticipantIds.length;

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

    for (const participant of updatedParticipants) {
      const participantUserId = participant.userId;
      this.server
        .to(`user:${participantUserId}`)
        .emit('group_participants_updated', eventData);
    }

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

      const participants =
        await this.dynamoDBService.getConversationParticipants(conversationId);
      const isUserInConversation = participants.some(
        (p) => p.userId === senderId,
      );

      if (!isUserInConversation) {
        client.emit('reply_error', {
          error: 'Usuario no está en la conversación',
        });
        return;
      }

      const originalMessage = await this.dynamoDBService.getMessage(replyTo);
      if (
        !originalMessage ||
        originalMessage.conversationId !== conversationId
      ) {
        client.emit('reply_error', { error: 'Mensaje original no encontrado' });
        return;
      }

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
        isReply: true,
      };

      await this.dynamoDBService.createMessage(replyMessageData);

      let replyPreview = originalMessage.content;
      if (
        originalMessage.messageType === 'file' ||
        originalMessage.messageType === 'audio'
      ) {
        try {
          const fileData = JSON.parse(originalMessage.content);
          const fileType =
            originalMessage.messageType === 'audio' ? 'Audio' : 'Archivo';
          replyPreview = `${fileType}: ${fileData.fileName || 'Sin nombre'}`;
        } catch {
          replyPreview =
            originalMessage.messageType === 'audio' ? 'Audio' : 'Archivo';
        }
      }

      if (replyPreview.length > 100) {
        replyPreview = replyPreview.substring(0, 97) + '...';
      }

      const user = await this.dynamoDBService.getUser(senderId);
      const senderInfo = {
        id: senderId,
        name: user?.name || 'Usuario',
        avatar: user?.avatar || '',
      };

      const eventData = {
        ...replyMessageData,
        replyPreview,
        sender: senderInfo,
      };

      this.server
        .to(`conversation:${conversationId}`)
        .emit('reply_received', eventData);

      client.emit('reply_sent_success', {
        messageId,
        conversationId,
        timestamp,
      });
    } catch (error) {
      console.error('Error processing reply:', error);
      client.emit('reply_error', { error: 'Error interno del servidor' });
    }
  }
}
