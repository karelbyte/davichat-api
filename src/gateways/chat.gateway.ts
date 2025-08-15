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
      status: 'online'
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
    @MessageBody() data: { name: string; description?: string; participants: string[]; createdBy: string },
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
    @MessageBody() data: { conversationId: string; userId: string; addedBy: string },
  ) {
    const { conversationId, userId, addedBy } = data;
    
    await this.dynamoDBService.addParticipant(conversationId, userId, {
      unreadCount: 0,
      lastReadAt: new Date().toISOString(),
      isActive: true,
    });

    this.server.to(`user:${userId}`).emit('user_added_to_group', {
      conversationId,
      userId,
      addedBy,
      timestamp: new Date().toISOString(),
    });
  }
}
