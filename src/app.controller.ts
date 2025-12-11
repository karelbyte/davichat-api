import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';
import { DynamoDBService } from './services/dynamodb.service';
import { RedisService } from './services/redis.service';
import { FileStorageService } from './services/file-storage.service';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ChatGateway } from './gateways/chat.gateway';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dynamoDBService: DynamoDBService,
    private readonly redisService: RedisService,
    private readonly fileStorageService: FileStorageService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Get()
  serveIndex(@Res() res: Response) {
    const indexPath = path.join(__dirname, '../public/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send('Chat API running');
    }
  }

  @Get('api/users')
  async getUsers() {
    const users = await this.dynamoDBService.getAllUsers();
    const onlineUsers = await this.redisService.getOnlineUsers();

    const usersWithStatus = users.map((user) => ({
      ...user,
      isOnline: onlineUsers.includes(user.id),
    }));

    return usersWithStatus.sort((a, b) => {
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return 0;
    });
  }

  @Get('api/users/:id')
  async getUser(@Param('id') userId: string) {
    const user = await this.dynamoDBService.getUser(userId);
    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    const onlineUsers = await this.redisService.getOnlineUsers();
    return {
      ...user,
      isOnline: onlineUsers.includes(user.id),
    };
  }

  @Post('api/users')
  async createUser(@Body() userData: any) {
    const existingUser = await this.dynamoDBService.getUser(userData.id);

    if (existingUser) {
      await this.dynamoDBService.updateUser(userData.id, userData);
      return { ...existingUser, ...userData };
    } else {
      await this.dynamoDBService.createUser(userData);
      return userData;
    }
  }

  @Post('api/conversations')
  async createConversation(
    @Body()
    data: {
      type: string;
      name?: string;
      description?: string;
      participants: string[];
      createdBy: string;
    },
  ) {
    if (data.type === 'private' && data.participants.length === 2) {
      const existingConversation =
        await this.dynamoDBService.findPrivateConversation(
          data.participants[0],
          data.participants[1],
        );

      if (existingConversation) {
        return existingConversation;
      }
    }

    const conversationId = require('uuid').v4();
    const conversationData = {
      id: conversationId,
      type: data.type,
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

    const creatorParticipant = await this.dynamoDBService.getParticipant(
      conversationId,
      data.createdBy,
    );

    return {
      ...conversationData,
      unreadCount: creatorParticipant?.unreadCount || 0,
      lastReadAt: creatorParticipant?.lastReadAt || new Date().toISOString(),
    };
  }

  @Post('api/conversations/:id/participants')
  async addParticipant(
    @Param('id') conversationId: string,
    @Body() data: { userId: string; addedBy: string },
  ) {
    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.dynamoDBService.addParticipant(conversationId, data.userId, {
      unreadCount: 0,
      lastReadAt: new Date().toISOString(),
      isActive: true,
    });

    return { success: true, conversationId, userId: data.userId };
  }

  @Delete('api/conversations/:id/participants/:userId')
  async removeParticipant(
    @Param('id') conversationId: string,
    @Param('userId') userId: string,
    @Body() body?: { removedBy?: string },
    @Query('removedBy') removedByQuery?: string,
  ) {
    const conversation =
      await this.dynamoDBService.getConversation(conversationId);
    if (!conversation) {
      throw new BadRequestException('Conversación no encontrada');
    }

    if (conversation.type !== 'group') {
      throw new BadRequestException('Solo puedes salir de grupos');
    }

    const participant = await this.dynamoDBService.getParticipant(
      conversationId,
      userId,
    );
    if (!participant) {
      throw new BadRequestException(
        'El usuario no es participante de este grupo',
      );
    }

    const participantsBefore =
      await this.dynamoDBService.getConversationParticipants(conversationId);

    // Determinar quién está eliminando: si removedBy está en el body o query, es un admin eliminando a otro usuario
    // Si no, es el mismo usuario saliendo (auto-salida)
    const removedBy = body?.removedBy || removedByQuery || userId;
    const isSelfRemoval = removedBy === userId;

    const originalCreatedBy = conversation.createdBy;
    const isOriginalCreator = originalCreatedBy === userId;
    let newCreatorId: string | null = null;

    if (isOriginalCreator && participantsBefore.length > 1) {
      const otherParticipant = participantsBefore.find(
        (p) => p.userId !== userId,
      );
      if (otherParticipant?.userId) {
        newCreatorId = otherParticipant.userId;
        await this.dynamoDBService.updateConversationCreatedBy(
          conversationId,
          otherParticipant.userId,
        );
      }
    }

    await this.dynamoDBService.removeParticipant(conversationId, userId);

    await new Promise((resolve) => setTimeout(resolve, 100));
    const updatedParticipants =
      await this.dynamoDBService.getConversationParticipants(conversationId);
    const updatedParticipantIds = updatedParticipants.map((p) => p.userId);
    const participantCount = updatedParticipantIds.length;

    const stillParticipant = updatedParticipants.some(
      (p) => p.userId === userId,
    );
    if (stillParticipant) {
      console.error(
        'El participante aún existe después de intentar eliminarlo',
      );
      throw new BadRequestException(
        'Error: el participante no se eliminó correctamente',
      );
    }

    if (participantCount === 0) {
      try {
        const remainingParticipants =
          await this.dynamoDBService.getConversationParticipants(
            conversationId,
          );
        for (const participant of remainingParticipants) {
          try {
            await this.dynamoDBService.removeParticipant(
              conversationId,
              participant.userId,
            );
          } catch (error) {
            console.error(
              `Error al eliminar participante restante ${participant.userId}:`,
              error,
            );
          }
        }

        const deletedMessagesCount =
          await this.dynamoDBService.deleteConversationMessages(conversationId);

        await this.dynamoDBService.deleteConversation(conversationId);

        // Obtener los participantes activos antes de que el último saliera
        // (excluyendo al usuario que acaba de salir)
        const activeParticipantsBeforeDeletion = participantsBefore.filter(
          (p) => p.userId !== userId,
        );

        // Enviar notificación solo a los participantes activos que quedaban
        // (no al usuario que ya salió)
        for (const participant of activeParticipantsBeforeDeletion) {
          this.chatGateway.server
            .to(`user:${participant.userId}`)
            .emit('group_deleted', {
              conversationId,
              conversationName: conversation.name,
              timestamp: new Date().toISOString(),
            });
        }

        return {
          success: true,
          conversationId,
          userId,
          message:
            'Usuario removido del grupo. El grupo fue eliminado porque quedó vacío.',
          participantCount: 0,
          groupDeleted: true,
          deletedMessagesCount,
        };
      } catch (error) {
        console.error('Error al eliminar grupo vacío:', error);
        throw new BadRequestException(
          'Error al eliminar el grupo vacío: ' + error.message,
        );
      }
    }

    const user = await this.dynamoDBService.getUser(userId);
    const userName = user?.name || 'Usuario';

    // Obtener información del usuario que está eliminando (removedBy)
    const removedByUser = await this.dynamoDBService.getUser(removedBy);
    const removedByName = removedByUser?.name || 'Usuario';

    const groupUpdateEventData = {
      conversationId,
      conversationName: conversation.name,
      participants: updatedParticipantIds,
      participantCount: updatedParticipantIds.length,
      updatedAt: new Date().toISOString(),
      action: 'remove' as const,
      affectedUsers: [userId],
      updatedBy: removedBy, // Quién está haciendo la eliminación (admin o el mismo usuario)
      removedBy: removedBy, // Quién está eliminando
      removedByName: removedByName, // Nombre de quien está eliminando
      leftBy: isSelfRemoval ? userName : removedByName, // Si es auto-salida, es userName; si no, es removedByName
      ownershipTransferred: isOriginalCreator && newCreatorId ? true : false,
      newOwnerId: newCreatorId || undefined,
    };

    let newOwnerName: string | undefined = undefined;
    if (isOriginalCreator && newCreatorId) {
      const newOwner = await this.dynamoDBService.getUser(newCreatorId);
      newOwnerName = newOwner?.name || 'Usuario';
    }

    // Notificar al usuario eliminado (B) que fue eliminado del grupo
    if (!isSelfRemoval) {
      this.chatGateway.server
        .to(`user:${userId}`)
        .emit('user_removed_from_group', {
          conversationId,
          conversationName: conversation.name,
          userId,
          userName,
          removedBy,
          removedByName,
          timestamp: new Date().toISOString(),
        });
    }

    // Notificar a los participantes que quedan en el grupo
    for (const participant of updatedParticipants) {
      this.chatGateway.server
        .to(`user:${participant.userId}`)
        .emit('user_left_group', {
          conversationId,
          conversationName: conversation.name,
          userId,
          userName,
          leftBy: isSelfRemoval ? userName : removedByName,
          removedBy: isSelfRemoval ? undefined : removedBy,
          removedByName: isSelfRemoval ? undefined : removedByName,
          timestamp: new Date().toISOString(),
          ownershipTransferred:
            isOriginalCreator && newCreatorId ? true : false,
          newOwnerId: newCreatorId || undefined,
          newOwnerName: newOwnerName,
        });
      this.chatGateway.server
        .to(`user:${participant.userId}`)
        .emit('group_participants_updated', {
          ...groupUpdateEventData,
          newOwnerName: newOwnerName,
        });
    }

    this.chatGateway.server
      .to(`conversation:${conversationId}`)
      .emit('user_left_group', {
        conversationId,
        conversationName: conversation.name,
        userId,
        userName,
        leftBy: isSelfRemoval ? userName : removedByName,
        removedBy: isSelfRemoval ? undefined : removedBy,
        removedByName: isSelfRemoval ? undefined : removedByName,
        timestamp: new Date().toISOString(),
        ownershipTransferred: isOriginalCreator && newCreatorId ? true : false,
        newOwnerId: newCreatorId || undefined,
        newOwnerName: newOwnerName,
      });
    this.chatGateway.server
      .to(`conversation:${conversationId}`)
      .emit('group_participants_updated', {
        ...groupUpdateEventData,
        newOwnerName: newOwnerName,
      });

    return {
      success: true,
      conversationId,
      userId,
      message: 'Usuario removido del grupo correctamente',
      participantCount: updatedParticipantIds.length,
    };
  }

  @Get('api/conversations/user/:userId')
  async getUserConversations(@Param('userId') userId: string) {
    const conversations =
      await this.dynamoDBService.getUserConversations(userId);
    return conversations;
  }

  @Post('api/conversations/:id/mark-as-read')
  async markConversationAsRead(
    @Param('id') conversationId: string,
    @Body() data: { userId: string },
  ) {
    await this.dynamoDBService.updateParticipantReadStatus(
      conversationId,
      data.userId,
      0,
      new Date().toISOString(),
    );

    this.chatGateway.server
      .to(`user:${data.userId}`)
      .emit('messages_marked_as_read', {
        conversationId,
        userId: data.userId,
        timestamp: new Date().toISOString(),
      });

    return {
      success: true,
      conversationId,
      userId: data.userId,
      message: 'Mensajes marcados como leídos',
    };
  }

  @Get('api/messages/:conversationId')
  async getConversationMessages(
    @Param('conversationId') conversationId: string,
  ) {
    const messages =
      await this.dynamoDBService.getConversationMessages(conversationId);
    return messages.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  @Post('api/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { conversationId: string; senderId: string },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!body.conversationId || !body.senderId) {
      throw new BadRequestException('conversationId and senderId are required');
    }

    const validation = this.fileStorageService.validateFile(file);
    if (!validation.isValid) {
      throw new BadRequestException(validation.error);
    }

    const fileData = await this.fileStorageService.uploadFile(file);

    const messageId = uuidv4();
    const timestamp = new Date().toISOString();

    const messageData = {
      id: messageId,
      conversationId: body.conversationId,
      senderId: body.senderId,
      content: JSON.stringify(fileData),
      messageType: 'file',
      timestamp,
      isEdited: false,
      isDeleted: false,
    };

    await this.dynamoDBService.createMessage(messageData);

    const conversation = await this.dynamoDBService.getConversation(
      body.conversationId,
    );
    const participants = await this.dynamoDBService.getConversationParticipants(
      body.conversationId,
    );

    this.chatGateway.server
      .to(`conversation:${body.conversationId}`)
      .emit('message_received', messageData);

    const onlineUsers = await this.redisService.getOnlineUsers();

    for (const participant of participants) {
      if (participant.userId === body.senderId) continue;

      const isOnline = onlineUsers.includes(participant.userId);
      const currentUnreadCount = participant.unreadCount || 0;

      await this.dynamoDBService.updateParticipantReadStatus(
        body.conversationId,
        participant.userId,
        currentUnreadCount + 1,
        participant.lastReadAt || new Date(0).toISOString(),
      );

      if (isOnline) {
        const unreadEvent = {
          type: conversation.type,
          conversationId: body.conversationId,
          senderId: body.senderId,
          messageId,
          content: fileData.fileName,
          timestamp,
        };

        this.chatGateway.server
          .to(`user:${participant.userId}`)
          .emit(
            conversation.type === 'private'
              ? 'unread_message_private'
              : 'unread_message_group',
            unreadEvent,
          );
      }
    }

    return {
      ...fileData,
      messageId,
      conversationId: body.conversationId,
      senderId: body.senderId,
      timestamp,
    };
  }

  @Get('api/files/:fileName')
  async serveFile(@Param('fileName') fileName: string, @Res() res: Response) {
    try {
      const storageType = this.fileStorageService['storageType'];
      let filePath: string;

      if (storageType === 'local') {
        filePath = path.join(this.fileStorageService['localPath'], fileName);
      } else if (storageType === 'ebs') {
        filePath = path.join(this.fileStorageService['ebsMountPath'], fileName);
      } else {
        const fileUrl = this.fileStorageService.getFileUrl(fileName);
        return res.redirect(fileUrl);
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileUrl = `/api/files/${fileName}`;
      let downloadFileName = fileName;

      try {
        const message = await this.dynamoDBService.getMessageByFileUrl(fileUrl);
        if (message && message.content) {
          const fileData = JSON.parse(message.content);
          if (fileData.fileName) {
            downloadFileName = fileData.fileName;
          }
        }
      } catch (error) {}

      const stats = fs.statSync(filePath);
      const fileStream = fs.createReadStream(filePath);

      const escapedFileName = downloadFileName.replace(/"/g, '\\"');
      const encodedFileName = encodeURIComponent(downloadFileName);

      res.set({
        'Content-Length': stats.size.toString(),
        'Content-Type': this.getMimeType(fileName),
        'Content-Disposition': `attachment; filename="${escapedFileName}"; filename*=UTF-8''${encodedFileName}`,
        'Cache-Control': 'public, max-age=31536000',
      });

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error serving file:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  @Get('api/files/avatars/:userId/:fileName')
  serveAvatarFile(
    @Param('userId') userId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    try {
      const storageType = this.fileStorageService['storageType'];
      let filePath: string;

      if (storageType === 'local') {
        filePath = path.join(
          this.fileStorageService['localPath'],
          'avatars',
          userId,
          fileName,
        );
      } else if (storageType === 'ebs') {
        filePath = path.join(
          this.fileStorageService['ebsMountPath'],
          'avatars',
          userId,
          fileName,
        );
      } else {
        const fileUrl = `https://${this.fileStorageService['s3Bucket']}.s3.amazonaws.com/avatars/${userId}/${fileName}`;
        return res.redirect(fileUrl);
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Avatar not found' });
      }

      const stats = fs.statSync(filePath);
      const fileStream = fs.createReadStream(filePath);

      res.set({
        'Content-Length': stats.size.toString(),
        'Content-Type': this.getMimeType(fileName),
        'Cache-Control': 'public, max-age=31536000',
      });

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error serving avatar file:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  @Get('/api/users')
  async getAllUsers() {
    return await this.dynamoDBService.getAllUsers();
  }

  @Delete('/api/users/:id')
  async deleteUser(@Param('id') id: string) {
    await this.dynamoDBService.deleteUser(id);
    return { message: 'Usuario eliminado correctamente' };
  }

  @Get('/api/conversations')
  async getAllConversations() {
    return await this.dynamoDBService.getAllConversations();
  }

  @Delete('/api/conversations/:id')
  async deleteConversation(@Param('id') id: string) {
    await this.dynamoDBService.deleteConversation(id);
    return { message: 'Conversación eliminada correctamente' };
  }

  @Get('/api/messages')
  async getAllMessages() {
    return await this.dynamoDBService.getAllMessages();
  }

  @Delete('/api/messages/:id')
  async deleteMessage(@Param('id') id: string) {
    await this.dynamoDBService.deleteMessage(id);
    return { message: 'Mensaje eliminado correctamente' };
  }

  @Delete('/api/messages')
  async deleteAllMessages() {
    try {
      const deletedCount = await this.dynamoDBService.deleteAllMessages();
      return {
        message: 'Todos los mensajes han sido eliminados correctamente',
        deletedCount,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error al eliminar mensajes: ${error.message}`,
      );
    }
  }

  @Delete('/api/messages/batch/:batchSize')
  async deleteMessagesInBatches(@Param('batchSize') batchSize: string) {
    try {
      const batchSizeNum = parseInt(batchSize, 10);
      if (isNaN(batchSizeNum) || batchSizeNum < 1 || batchSizeNum > 25) {
        throw new BadRequestException(
          'batchSize debe ser un número entre 1 y 25',
        );
      }

      const deletedCount =
        await this.dynamoDBService.deleteMessagesInBatches(batchSizeNum);
      return {
        message: `Mensajes eliminados en lotes de ${batchSizeNum}`,
        deletedCount,
        batchSize: batchSizeNum,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error al eliminar mensajes en lotes: ${error.message}`,
      );
    }
  }

  @Post('api/users/:id/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  async updateUserAvatar(
    @Param('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó archivo de avatar');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }

    const maxAvatarSize = 5 * 1024 * 1024;
    if (file.size > maxAvatarSize) {
      throw new BadRequestException(
        'El archivo de avatar es demasiado grande (máximo 5MB)',
      );
    }

    const currentUser = await this.dynamoDBService.getUser(userId);
    if (!currentUser) {
      throw new BadRequestException('Usuario no encontrado');
    }

    const fileData = await this.fileStorageService.uploadUserAvatar(
      file,
      userId,
    );

    await this.dynamoDBService.updateUser(userId, {
      avatar: fileData.fileUrl,
    });

    if (currentUser.avatar) {
      try {
        await this.fileStorageService.deleteFile(currentUser.avatar);
      } catch (error) {}
    }

    return {
      success: true,
      message: 'Avatar actualizado correctamente',
      avatar: fileData.fileUrl,
    };
  }

  @Delete('api/users/:id/avatar')
  async deleteUserAvatar(@Param('id') userId: string) {
    const currentUser = await this.dynamoDBService.getUser(userId);
    if (!currentUser) {
      throw new BadRequestException('Usuario no encontrado');
    }

    if (!currentUser.avatar) {
      throw new BadRequestException('El usuario no tiene avatar');
    }

    try {
      await this.fileStorageService.deleteFile(currentUser.avatar);
    } catch (error) {}

    await this.dynamoDBService.updateUser(userId, {
      avatar: null,
    });

    return {
      success: true,
      message: 'Avatar eliminado correctamente',
    };
  }

  @Get('/admin')
  serveAdmin(@Res() res: Response) {
    const adminPath = path.join(__dirname, '../public/admin.html');

    if (fs.existsSync(adminPath)) {
      res.sendFile(adminPath);
    } else {
      res.send('Admin panel not found');
    }
  }
}
