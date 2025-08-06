# API Documentación - Chat con NestJS, Redis, DynamoDB y Socket.IO

## Arquitectura

- **Backend**: NestJS con Socket.IO para WebSockets
- **Base de Datos**: DynamoDB (persistencia) + Redis (cache/velocidad)
- **Almacenamiento**: Local o AWS S3 para archivos
- **Real-time**: Socket.IO con Redis Adapter para escalabilidad

## Variables de Entorno

```env
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

AWS_ACCESS_KEY_ID=key
AWS_SECRET_ACCESS_KEY=key
AWS_REGION=us-east-1
DYNAMODB_ENDPOINT=http://localhost:8000

PORT=3000
NODE_ENV=development

SOCKET_CORS_ORIGIN=*

FILE_STORAGE_TYPE=local
FILE_UPLOAD_MAX_SIZE=10485760
FILE_ALLOWED_TYPES=image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/m4a,audio/webm,audio/wave,audio/x-wav,audio/x-pn-wav,audio/vnd.wave
FILE_STORAGE_LOCAL_PATH=./uploads
FILE_STORAGE_S3_BUCKET=chat-files
FILE_STORAGE_S3_REGION=us-east-1
```

## Dependencias Backend

```json
{
  "@nestjs/common": "^10.0.0",
  "@nestjs/core": "^10.0.0",
  "@nestjs/platform-express": "^10.0.0",
  "@nestjs/websockets": "^10.0.0",
  "@nestjs/platform-socket.io": "^10.0.0",
  "@nestjs/config": "^3.0.0",
  "socket.io": "^4.7.0",
  "redis": "^4.6.0",
  "@socket.io/redis-adapter": "^8.0.0",
  "@aws-sdk/client-dynamodb": "^3.0.0",
  "@aws-sdk/lib-dynamodb": "^3.0.0",
  "uuid": "^9.0.0",
  "class-validator": "^0.14.0",
  "class-transformer": "^0.5.1",
  "multer": "^1.4.5"
}
```

## Dependencias Frontend

```json
{
  "socket.io-client": "^4.7.0",
  "axios": "^1.4.0"
}
```

## Base URL

```
http://localhost:3000
```

## Endpoints REST

### Usuarios

#### GET /api/users
**Descripción**: Obtener lista de usuarios ordenados por estado online

**Respuesta**:
```json
{
  "users": [
    {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "roles": ["string"],
      "filials": ["string"],
      "status": "online|offline",
      "lastSeen": "2024-01-01T00:00:00.000Z",
      "avatar": "string|null",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "isActive": true,
      "isOnline": true
    }
  ]
}
```

#### POST /api/users
**Descripción**: Crear nuevo usuario

**Body**:
```json
{
  "id": "uuid",
  "name": "string",
  "email": "string",
  "roles": ["string"],
  "filials": ["string"],
  "avatar": "string|null"
}
```

### Conversaciones

#### POST /api/conversations
**Descripción**: Crear conversación (privada o grupo)

**Body**:
```json
{
  "type": "private|group",
  "name": "string", // solo para grupos
  "description": "string", // solo para grupos
  "participants": ["uuid"],
  "createdBy": "uuid"
}
```

**Respuesta**:
```json
{
  "id": "uuid",
  "type": "private|group",
  "name": "string",
  "description": "string",
  "participants": ["uuid"],
  "createdBy": "uuid",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

#### POST /api/conversations/:id/participants
**Descripción**: Añadir participantes a conversación

**Body**:
```json
{
  "participants": ["uuid"]
}
```

#### GET /api/conversations/user/:userId
**Descripción**: Obtener conversaciones de un usuario

**Respuesta**:
```json
{
  "conversations": [
    {
      "id": "uuid",
      "type": "private|group",
      "name": "string",
      "description": "string",
      "participants": ["uuid"],
      "createdBy": "uuid",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Mensajes

#### GET /api/messages/:conversationId
**Descripción**: Obtener mensajes de una conversación

**Respuesta**:
```json
{
  "messages": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "senderId": "uuid",
      "recipientId": "uuid",
      "content": "string",
      "messageType": "text|file|audio",
      "fileUrl": "string|null",
      "fileName": "string|null",
      "fileSize": "number|null",
      "fileType": "string|null",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Archivos

#### POST /api/upload
**Descripción**: Subir archivo

**Body**: `multipart/form-data`
- `file`: Archivo a subir

**Respuesta**:
```json
{
  "url": "string",
  "fileName": "string",
  "fileSize": "number",
  "fileType": "string"
}
```

## Eventos Socket.IO

### Cliente → Servidor

#### user_join
**Descripción**: Usuario se conecta al chat

**Datos**:
```typescript
{
  userId: string;
  name: string;
  email: string;
  roles: string[];
  filials: string[];
  avatar?: string;
}
```

#### user_leave
**Descripción**: Usuario se desconecta del chat

**Datos**:
```typescript
{
  userId: string;
}
```

#### join_room
**Descripción**: Unirse a una conversación

**Datos**:
```typescript
{
  conversationId: string;
  userId: string;
}
```

#### leave_room
**Descripción**: Salir de una conversación

**Datos**:
```typescript
{
  conversationId: string;
  userId: string;
}
```

#### send_message
**Descripción**: Enviar mensaje

**Datos**:
```typescript
{
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: 'text' | 'file' | 'audio';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}
```

#### typing_start
**Descripción**: Usuario comienza a escribir

**Datos**:
```typescript
{
  conversationId: string;
  userId: string;
  userName: string;
}
```

#### typing_stop
**Descripción**: Usuario deja de escribir

**Datos**:
```typescript
{
  conversationId: string;
  userId: string;
}
```

#### user_status
**Descripción**: Actualizar estado del usuario

**Datos**:
```typescript
{
  userId: string;
  status: 'online' | 'offline';
}
```

#### mark_messages_as_read
**Descripción**: Marcar mensajes como leídos

**Datos**:
```typescript
{
  conversationId: string;
  userId: string;
}
```

#### create_group
**Descripción**: Crear grupo

**Datos**:
```typescript
{
  name: string;
  description?: string;
  participants: string[];
  createdBy: string;
}
```

#### add_user_to_group
**Descripción**: Añadir usuario a grupo

**Datos**:
```typescript
{
  conversationId: string;
  participants: string[];
}
```

### Servidor → Cliente

#### user_connected
**Descripción**: Nuevo usuario conectado

**Datos**:
```typescript
{
  user: {
    id: string;
    name: string;
    email: string;
    roles: string[];
    filials: string[];
    status: 'online' | 'offline';
    lastSeen: string;
    avatar?: string;
    createdAt: string;
    updatedAt: string;
    isActive: boolean;
    isOnline: boolean;
  };
}
```

#### user_disconnected
**Descripción**: Usuario desconectado

**Datos**:
```typescript
{
  userId: string;
  lastSeen: string;
}
```

#### user_status_update
**Descripción**: Actualización de estado de usuario

**Datos**:
```typescript
{
  userId: string;
  status: 'online' | 'offline';
  lastSeen: string;
}
```

#### message_received
**Descripción**: Mensaje recibido

**Datos**:
```typescript
{
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: 'text' | 'file' | 'audio';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    avatar?: string;
  };
}
```

#### typing_indicator
**Descripción**: Indicador de escritura

**Datos**:
```typescript
{
  conversationId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}
```

#### unread_message_private
**Descripción**: Mensaje no leído en conversación privada

**Datos**:
```typescript
{
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  messagePreview: string;
  timestamp: string;
}
```

#### unread_message_group
**Descripción**: Mensaje no leído en grupo

**Datos**:
```typescript
{
  conversationId: string;
  conversationName: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  messagePreview: string;
  timestamp: string;
}
```

#### group_created
**Descripción**: Grupo creado

**Datos**:
```typescript
{
  id: string;
  type: 'group';
  name: string;
  description?: string;
  participants: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

#### user_added_to_group
**Descripción**: Usuario añadido a grupo

**Datos**:
```typescript
{
  conversationId: string;
  conversationName: string;
  addedUsers: string[];
  addedBy: string;
}
```

## Estructuras de Datos

### Usuario
```typescript
interface Usuario {
  id: string;
  name: string;
  email: string;
  roles: string[];
  filials: string[];
  status: 'online' | 'offline';
  lastSeen: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  isOnline: boolean;
}
```

### Conversación
```typescript
interface Conversación {
  id: string;
  type: 'private' | 'group';
  name?: string;
  description?: string;
  participants: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### Participante de Conversación
```typescript
interface ParticipanteConversación {
  id: string;
  conversationId: string;
  userId: string;
  joinedAt: string;
  lastReadAt?: string;
}
```

### Mensaje
```typescript
interface Mensaje {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: 'text' | 'file' | 'audio';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  createdAt: string;
}
```

### Evento de Mensaje No Leído
```typescript
interface EventoMensajeNoLeído {
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  messagePreview: string;
  timestamp: string;
}
```

## Arquitectura de Datos

### DynamoDB (Persistencia Principal)
- **users**: Información de usuarios
- **conversations**: Conversaciones (privadas y grupos)
- **conversation_participants**: Participantes de conversaciones
- **messages**: Mensajes de todas las conversaciones

### Redis (Cache/Velocidad)
- **Online users**: Usuarios conectados
- **Temporary data**: Datos temporales
- **Socket.IO adapter**: Escalabilidad de WebSockets

## Funcionalidad de Conversaciones Privadas

### Lógica de Persistencia
1. **Creación**: Al crear conversación privada, se busca si ya existe entre los usuarios
2. **Búsqueda**: Si existe, se retorna la conversación existente
3. **Nueva**: Si no existe, se crea una nueva conversación
4. **Participantes**: Se añaden automáticamente ambos usuarios

## Endpoints REST Implementados

### GET /api/users
- Retorna usuarios ordenados por estado online
- Incluye información de conexión actual

### POST /api/users
- Crea nuevo usuario
- Valida datos requeridos

### POST /api/conversations
- Crea conversación privada o grupo
- Para privadas: busca conversación existente
- Para grupos: crea nueva conversación

### POST /api/conversations/:id/participants
- Añade participantes a conversación existente
- Valida que la conversación sea de tipo grupo

### GET /api/conversations/user/:userId
- Obtiene todas las conversaciones de un usuario
- Incluye información de participantes

## Funcionalidad de Indicador de Escritura

### Implementación
1. **Cliente emite**: `typing_start` cuando usuario comienza a escribir
2. **Servidor procesa**: Emite `typing_indicator` a todos en la conversación
3. **Cliente recibe**: Muestra indicador de escritura
4. **Timeout**: Después de 3 segundos sin escribir, emite `typing_stop`

### Lógica
- Solo se muestra a otros usuarios (no al que escribe)
- Se emite a todos los participantes de la conversación
- Se limpia automáticamente después del timeout

## Funcionalidad de Añadir Participantes a Grupos

### Implementación
1. **Cliente emite**: `add_user_to_group` con lista de participantes
2. **Servidor procesa**: Añade participantes a la conversación
3. **Servidor emite**: `user_added_to_group` a todos los participantes
4. **Cliente recibe**: Actualiza lista de participantes

### Validaciones
- Solo conversaciones de tipo grupo
- Usuarios deben existir en el sistema
- No duplicar participantes existentes

## Funcionalidad de Archivos

### Tipos Soportados
- **Imágenes**: JPEG, PNG, GIF, WebP
- **Documentos**: PDF, DOC, DOCX, TXT
- **Audio**: MP3, WAV, OGG, M4A, WebM

### Almacenamiento
- **Local**: Archivos en carpeta `./uploads`
- **AWS S3**: Archivos en bucket configurado

### Validación
- **Tamaño máximo**: 10MB por defecto
- **Tipos permitidos**: Configurables por variable de entorno
- **Nombres únicos**: UUID + timestamp

### Endpoints
- **POST /api/upload**: Subir archivo
- **GET /uploads/:filename**: Descargar archivo (local)

## Configuración AWS S3

### Bucket Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::chat-files/*"
    }
  ]
}
```

### URLs
- **Local**: `http://localhost:3000/uploads/filename.ext`
- **S3**: `https://chat-files.s3.amazonaws.com/filename.ext`

## Soporte de audio

### Funcionalidades
- **Grabación**: Usando MediaRecorder API
- **Formatos**: WAV, MP3, OGG, M4A, WebM
- **Almacenamiento**: Local o S3
- **Reproducción**: HTML5 Audio player

### Implementación Frontend
- **Grabación**: Botón de grabación con indicador visual
- **Procesamiento**: Conversión a Blob antes de subir
- **Reproducción**: Player integrado en chat

## Funcionalidades Pendientes de Implementación

### Video Calls
- **WebRTC**: Implementación de video calls
- **Signaling**: Usando Socket.IO para signaling
- **Rooms**: Salas de video separadas por conversación

## Guía de Uso para Frontend

### Conexión WebSocket
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  transports: ['websocket'],
  autoConnect: false
});

socket.on('connect', () => {
  console.log('Conectado al servidor');
});

socket.on('disconnect', () => {
  console.log('Desconectado del servidor');
});
```

### Eventos de Usuario
```javascript
// Unirse al chat
socket.emit('user_join', {
  userId: 'user123',
  name: 'Juan Pérez',
  email: 'juan@example.com',
  roles: ['user'],
  filials: ['sucursal1'],
  avatar: 'avatar.jpg'
});

// Salir del chat
socket.emit('user_leave', {
  userId: 'user123'
});

// Escuchar nuevos usuarios
socket.on('user_connected', (data) => {
  console.log('Nuevo usuario:', data.user);
});

// Escuchar desconexiones
socket.on('user_disconnected', (data) => {
  console.log('Usuario desconectado:', data.userId);
});
```

### Eventos de Conversación
```javascript
// Unirse a conversación
socket.emit('join_room', {
  conversationId: 'conv123',
  userId: 'user123'
});

// Salir de conversación
socket.emit('leave_room', {
  conversationId: 'conv123',
  userId: 'user123'
});

// Crear grupo
socket.emit('create_group', {
  name: 'Mi Grupo',
  description: 'Descripción del grupo',
  participants: ['user1', 'user2', 'user3'],
  createdBy: 'user123'
});

// Escuchar grupo creado
socket.on('group_created', (data) => {
  console.log('Grupo creado:', data);
});
```

### Envío y Recepción de Mensajes
```javascript
// Enviar mensaje
socket.emit('send_message', {
  conversationId: 'conv123',
  senderId: 'user123',
  recipientId: 'user456',
  content: 'Hola, ¿cómo estás?',
  messageType: 'text'
});

// Recibir mensaje
socket.on('message_received', (message) => {
  console.log('Mensaje recibido:', message);
  // message = {
  //   id: 'msg123',
  //   conversationId: 'conv123',
  //   senderId: 'user456',
  //   recipientId: 'user123',
  //   content: 'Hola, ¿cómo estás?',
  //   messageType: 'text',
  //   createdAt: '2024-01-01T00:00:00.000Z',
  //   sender: {
  //     id: 'user456',
  //     name: 'María García',
  //     avatar: 'avatar.jpg'
  //   }
  // }
});
```

### Indicadores de Escritura
```javascript
// Comenzar a escribir
socket.emit('typing_start', {
  conversationId: 'conv123',
  userId: 'user123',
  userName: 'Juan Pérez'
});

// Dejar de escribir
socket.emit('typing_stop', {
  conversationId: 'conv123',
  userId: 'user123'
});

// Escuchar indicadores
socket.on('typing_indicator', (data) => {
  console.log(`${data.userName} está escribiendo...`);
  // data = {
  //   conversationId: 'conv123',
  //   userId: 'user456',
  //   userName: 'María García',
  //   isTyping: true
  // }
});
```

### Mensajes No Leídos
```javascript
// Escuchar mensajes no leídos privados
socket.on('unread_message_private', (data) => {
  console.log('Mensaje privado no leído:', data);
  // data = {
  //   senderId: 'user456',
  //   senderName: 'María García',
  //   senderAvatar: 'avatar.jpg',
  //   messagePreview: 'Hola, ¿cómo estás?',
  //   timestamp: '2024-01-01T00:00:00.000Z'
  // }
});

// Escuchar mensajes no leídos de grupo
socket.on('unread_message_group', (data) => {
  console.log('Mensaje de grupo no leído:', data);
  // data = {
  //   conversationId: 'conv123',
  //   conversationName: 'Mi Grupo',
  //   senderId: 'user456',
  //   senderName: 'María García',
  //   senderAvatar: 'avatar.jpg',
  //   messagePreview: 'Hola a todos!',
  //   timestamp: '2024-01-01T00:00:00.000Z'
  // }
});
```

### API REST con Axios
```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
  timeout: 10000
});

// Obtener usuarios
const getUsers = async () => {
  try {
    const response = await api.get('/users');
    return response.data.users;
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
  }
};

// Crear usuario
const createUser = async (userData) => {
  try {
    const response = await api.post('/users', userData);
    return response.data;
  } catch (error) {
    console.error('Error creando usuario:', error);
  }
};

// Crear conversación
const createConversation = async (conversationData) => {
  try {
    const response = await api.post('/conversations', conversationData);
    return response.data;
  } catch (error) {
    console.error('Error creando conversación:', error);
  }
};

// Obtener conversaciones de usuario
const getUserConversations = async (userId) => {
  try {
    const response = await api.get(`/conversations/user/${userId}`);
    return response.data.conversations;
  } catch (error) {
    console.error('Error obteniendo conversaciones:', error);
  }
};

// Obtener mensajes
const getMessages = async (conversationId) => {
  try {
    const response = await api.get(`/messages/${conversationId}`);
    return response.data.messages;
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
  }
};

// Subir archivo
const uploadFile = async (file) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await api.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error subiendo archivo:', error);
  }
};
```

## Códigos de Error

### HTTP Status Codes
- **200**: OK - Operación exitosa
- **201**: Created - Recurso creado
- **400**: Bad Request - Datos inválidos
- **404**: Not Found - Recurso no encontrado
- **500**: Internal Server Error - Error del servidor

### Socket.IO Error Events
```javascript
socket.on('connect_error', (error) => {
  console.error('Error de conexión:', error);
});

socket.on('error', (error) => {
  console.error('Error de Socket.IO:', error);
});
```

## Rate Limiting

### Límites por Defecto
- **Mensajes**: 10 por minuto por usuario
- **Archivos**: 5 por minuto por usuario
- **Conexiones**: 100 por minuto por IP

## Webhooks (Futuro)

### Eventos Disponibles
- `user.created`: Usuario creado
- `message.sent`: Mensaje enviado
- `conversation.created`: Conversación creada
- `file.uploaded`: Archivo subido

### Configuración
```javascript
// Enviar webhook
const webhookData = {
  event: 'message.sent',
  data: messageData,
  timestamp: new Date().toISOString()
};

await axios.post(webhookUrl, webhookData);
```