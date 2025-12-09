# Funcionalidad: Salir de un Grupo

## 🎯 Transparencia para el Frontend

**Esta funcionalidad es completamente transparente para el frontend.** El backend maneja automáticamente:

- ✅ **Transferencia de propiedad**: Si el creador sale, la propiedad se transfiere automáticamente a otro participante. El frontend solo recibe notificación opcional.
- ✅ **Eliminación automática**: Si el último usuario sale, el grupo se elimina completamente. El frontend solo necesita escuchar `group_deleted` y remover el grupo de la lista.
- ✅ **Actualización de participantes**: Los eventos incluyen la lista actualizada de participantes, el frontend solo necesita actualizar su UI.

**El frontend solo necesita:**
1. Escuchar `leave_group_success` y remover el grupo de la lista cuando el usuario sale
2. Escuchar `group_deleted` y remover el grupo de la lista cuando se elimina
3. Escuchar `user_left_group` y `group_participants_updated` para actualizar la UI cuando otros usuarios salen

**No necesita:**
- ❌ Verificar si el usuario es el creador
- ❌ Manejar lógica de transferencia de propiedad
- ❌ Verificar si quedan participantes
- ❌ Eliminar mensajes manualmente
- ❌ Gestionar la eliminación del grupo

---

## Descripción General

Esta funcionalidad permite que un usuario salga voluntariamente de un grupo de chat. Cuando un usuario sale del grupo:

- ✅ **Sus mensajes anteriores permanecen visibles** con su nombre original
- ✅ **Ya no recibirá nuevos mensajes** del grupo
- ✅ **Los demás participantes son notificados** en tiempo real
- ✅ **Si vuelve a entrar al grupo**, podrá ver los mensajes nuevos que se enviaron después de salir
- 👑 **Si el creador sale**, la propiedad del grupo se transfiere automáticamente a otro participante
- 🗑️ **Si el último usuario sale**, el grupo se elimina completamente junto con todo su historial

> **Nota importante**: Los mensajes del usuario que salió **NO se eliminan** (a menos que sea el último usuario y el grupo se elimine). Esto es similar a cuando te sales de un grupo de WhatsApp o Telegram: tus mensajes quedan en el historial, pero ya no recibes nuevas notificaciones.

---

## Eventos WebSocket

### Cliente → Servidor

#### `leave_group`
**Descripción**: Solicita salir de un grupo

**Datos a enviar**:
```typescript
{
  conversationId: string;  // ID del grupo del que se quiere salir
  userId: string;         // ID del usuario que quiere salir
}
```

**Ejemplo**:
```javascript
socket.emit('leave_group', {
  conversationId: 'group-uuid-123',
  userId: 'user-uuid-456'
});
```

---

### Servidor → Cliente

#### `leave_group_success`
**Descripción**: Confirmación de que el usuario salió exitosamente del grupo

**Datos recibidos**:
```typescript
{
  conversationId: string;
  conversationName: string;
  timestamp: string;
  groupDeleted?: boolean;         // true si el grupo fue eliminado (último usuario)
  deletedMessagesCount?: number;  // Cantidad de mensajes eliminados (si el grupo fue eliminado)
}
```

**Ejemplo de manejo**:
```javascript
socket.on('leave_group_success', (data) => {
  if (data.groupDeleted) {
    console.log('Grupo eliminado porque quedó vacío:', data.conversationName);
    console.log(`Se eliminaron ${data.deletedMessagesCount} mensajes`);
    showNotification(`El grupo "${data.conversationName}" fue eliminado`);
  } else {
    console.log('Saliste exitosamente del grupo:', data.conversationName);
    showNotification(`Saliste del grupo "${data.conversationName}"`);
  }
  
  // Actualizar UI: remover grupo de la lista
  removeGroupFromList(data.conversationId);
});
```

---

#### `leave_group_error`
**Descripción**: Error al intentar salir del grupo

**Datos recibidos**:
```typescript
{
  error: string;  // Mensaje de error descriptivo
}
```

**Posibles errores**:
- `"Conversación no encontrada"` - El grupo no existe
- `"Solo puedes salir de grupos"` - Se intentó salir de una conversación privada
- `"No eres participante de este grupo"` - El usuario no está en el grupo
- `"Error al salir del grupo"` - Error interno del servidor

**Ejemplo de manejo**:
```javascript
socket.on('leave_group_error', (data) => {
  console.error('Error al salir del grupo:', data.error);
  showErrorNotification(data.error);
});
```

---

#### `user_left_group`
**Descripción**: Notificación cuando un usuario sale del grupo (se emite a todos los participantes restantes)

**Datos recibidos**:
```typescript
{
  conversationId: string;
  conversationName: string;
  userId: string;          // ID del usuario que salió
  userName: string;         // Nombre del usuario que salió
  leftBy: string;          // Nombre del usuario que salió (alias)
  timestamp: string;
  ownershipTransferred?: boolean;  // true si el creador salió y se transfirió la propiedad
  newOwnerId?: string;             // ID del nuevo propietario (si hubo transferencia)
  newOwnerName?: string;           // Nombre del nuevo propietario (si hubo transferencia)
}
```

**Ejemplo de manejo**:
```javascript
socket.on('user_left_group', (data) => {
  console.log(`${data.userName} salió del grupo "${data.conversationName}"`);
  
  // Si hubo transferencia de propiedad, mostrar notificación especial
  if (data.ownershipTransferred && data.newOwnerName) {
    showSystemMessage(
      `${data.userName} salió del grupo. ${data.newOwnerName} es ahora el administrador.`
    );
  } else {
    showSystemMessage(`${data.userName} salió del grupo`);
  }
  
  // Si es el grupo actual, actualizar UI
  if (currentConversationId === data.conversationId) {
    updateParticipantsList(data.conversationId);
    // Si hubo transferencia, actualizar información del propietario
    if (data.ownershipTransferred && data.newOwnerId) {
      updateGroupOwner(data.conversationId, data.newOwnerId, data.newOwnerName);
    }
  }
  
  // Actualizar contador de participantes en la lista de grupos
  updateGroupParticipantCount(data.conversationId);
});
```

---

#### `group_left`
**Descripción**: Alias de `user_left_group` (compatibilidad con documentación anterior)

**Datos recibidos**: Igual que `user_left_group`

---

#### `group_participants_updated`
**Descripción**: Actualización de la lista de participantes del grupo (se emite cuando alguien sale)

**Datos recibidos**:
```typescript
{
  conversationId: string;
  conversationName: string;
  participants: string[];        // Array de IDs de participantes restantes
  participantCount: number;       // Cantidad de participantes
  updatedAt: string;
  action: 'remove';               // Acción realizada
  affectedUsers: string[];        // IDs de usuarios afectados (el que salió)
  updatedBy: string;              // ID del usuario que realizó la acción
  leftBy: string;                 // Nombre del usuario que salió
  ownershipTransferred?: boolean; // true si el creador salió y se transfirió la propiedad
  newOwnerId?: string;            // ID del nuevo propietario (si hubo transferencia)
  newOwnerName?: string;          // Nombre del nuevo propietario (si hubo transferencia)
}
```

**Ejemplo de manejo**:
```javascript
socket.on('group_participants_updated', (data) => {
  if (data.action === 'remove') {
    console.log('Participantes actualizados:', data.participants);
    
    // Si hubo transferencia de propiedad, mostrar notificación
    if (data.ownershipTransferred && data.newOwnerName) {
      showNotification(
        `La propiedad del grupo fue transferida a ${data.newOwnerName}`
      );
    }
    
    // Actualizar lista de participantes en la UI
    if (currentConversationId === data.conversationId) {
      updateParticipantsList(data.participants);
      updateParticipantCount(data.participantCount);
      
      // Actualizar información del propietario si hubo transferencia
      if (data.ownershipTransferred && data.newOwnerId) {
        updateGroupOwner(data.conversationId, data.newOwnerId, data.newOwnerName);
      }
    }
    
    // Actualizar badge de participantes en la lista de grupos
    updateGroupBadge(data.conversationId, data.participantCount);
  }
});
```

---

## Endpoints REST

### `DELETE /api/conversations/:id/participants/:userId`

**Descripción**: Salir de un grupo mediante REST API

**Parámetros de URL**:
- `id`: ID de la conversación (grupo)
- `userId`: ID del usuario que quiere salir

**Ejemplo de uso**:
```javascript
async function leaveGroup(conversationId, userId) {
  try {
    const response = await fetch(
      `/api/conversations/${conversationId}/participants/${userId}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al salir del grupo');
    }

    const result = await response.json();
    console.log('Saliste del grupo:', result);
    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Uso
leaveGroup('group-uuid-123', 'user-uuid-456');
```

**Respuesta exitosa** (200):
```json
{
  "success": true,
  "conversationId": "group-uuid-123",
  "userId": "user-uuid-456",
  "message": "Usuario removido del grupo correctamente",
  "participantCount": 5
}
```

**Errores posibles**:
- `400 Bad Request`: 
  - `"Conversación no encontrada"`
  - `"Solo puedes salir de grupos"`
  - `"El usuario no es participante de este grupo"`

---

## Flujo Completo de Implementación (Mínimo Requerido)

> **💡 Nota**: El backend maneja todo automáticamente. El frontend solo necesita escuchar eventos y actualizar la UI.

### 1. Botón/Acción para Salir del Grupo

```javascript
function handleLeaveGroup(conversationId, userId) {
  // Confirmar acción
  const confirmed = confirm('¿Estás seguro de que quieres salir de este grupo?');
  if (!confirmed) return;

  // Enviar evento WebSocket
  socket.emit('leave_group', {
    conversationId: conversationId,
    userId: userId
  });
}
```

### 2. Escuchar Confirmación (Mínimo Requerido)

```javascript
// ✅ MÍNIMO REQUERIDO: Solo esto es necesario
socket.on('leave_group_success', (data) => {
  // Remover grupo de la lista (automático, el backend ya lo eliminó si era necesario)
  removeConversationFromList(data.conversationId);
  
  // Si es la conversación actual, limpiar vista
  if (currentConversationId === data.conversationId) {
    currentConversationId = null;
    clearChatView();
    showEmptyState();
  }
  
  // Notificación opcional
  if (data.groupDeleted) {
    showNotification(`El grupo "${data.conversationName}" fue eliminado`);
  } else {
    showNotification(`Saliste del grupo "${data.conversationName}"`);
  }
});

// ✅ OPCIONAL: Escuchar cuando otros usuarios salen
socket.on('user_left_group', (data) => {
  // Si es el grupo actual, mostrar mensaje del sistema
  if (currentConversationId === data.conversationId) {
    addSystemMessage(`${data.userName} salió del grupo`);
    refreshParticipantsList(); // Actualizar lista de participantes
  }
});

// ✅ OPCIONAL: Escuchar cuando el grupo se elimina (para otros usuarios)
socket.on('group_deleted', (data) => {
  // Remover grupo de la lista (si estaba en la lista del usuario)
  removeConversationFromList(data.conversationId);
  
  // Si es el grupo actual, limpiar vista
  if (currentConversationId === data.conversationId) {
    currentConversationId = null;
    clearChatView();
    showEmptyState();
  }
});
```

### 3. Manejar Errores (Opcional pero Recomendado)

```javascript
socket.on('leave_group_error', (data) => {
  showErrorNotification(data.error);
  console.error('Error al salir del grupo:', data.error);
});
```

### 4. Actualizar UI cuando Otro Usuario Sale (Opcional)

```javascript
// Opcional: Mostrar notificación cuando alguien sale
socket.on('user_left_group', (data) => {
  // Si es el grupo actual, mostrar mensaje del sistema
  if (currentConversationId === data.conversationId) {
    let message = `${data.userName} salió del grupo`;
    
    // Opcional: Mostrar notificación si hubo transferencia de propiedad
    if (data.ownershipTransferred && data.newOwnerName) {
      message += `. ${data.newOwnerName} es ahora el administrador.`;
    }
    
    addSystemMessage({
      type: 'system',
      content: message,
      timestamp: data.timestamp
    });
    
    // Actualizar lista de participantes
    refreshParticipantsList();
  }
});

// Opcional: Actualizar lista de participantes en tiempo real
socket.on('group_participants_updated', (data) => {
  if (data.action === 'remove' && currentConversationId === data.conversationId) {
    // Actualizar lista de participantes (el backend ya actualizó todo)
    updateParticipantsList(data.participants);
    updateParticipantCount(data.participantCount);
    
    // Opcional: Mostrar notificación de transferencia de propiedad
    if (data.ownershipTransferred && data.newOwnerName) {
      showNotification(`La propiedad del grupo fue transferida a ${data.newOwnerName}`);
    }
  }
});
```

---

## 📋 Resumen: Lo Mínimo que Necesita el Frontend

### Eventos Mínimos Requeridos:

```javascript
// 1. Escuchar confirmación cuando el usuario sale
socket.on('leave_group_success', (data) => {
  removeConversationFromList(data.conversationId);
  if (currentConversationId === data.conversationId) {
    clearChatView();
  }
});

// 2. Escuchar cuando el grupo se elimina (para otros usuarios)
socket.on('group_deleted', (data) => {
  removeConversationFromList(data.conversationId);
  if (currentConversationId === data.conversationId) {
    clearChatView();
  }
});
```

**Eso es todo.** El backend maneja automáticamente:
- ✅ Transferencia de propiedad
- ✅ Eliminación del grupo cuando queda vacío
- ✅ Eliminación de mensajes
- ✅ Actualización de participantes
- ✅ Notificaciones a todos los usuarios

Los demás eventos (`user_left_group`, `group_participants_updated`) son **opcionales** y solo sirven para mejorar la UX mostrando notificaciones en tiempo real.

---

## Consideraciones Importantes

### 1. Mensajes del Usuario que Salió

- ✅ **Los mensajes permanecen visibles** en el historial del grupo
- ✅ **Se muestran con el nombre original** del usuario
- ✅ **No se eliminan ni se anonimizan** (excepto si el grupo se elimina completamente)

### 2. Notificaciones

- ❌ **El usuario que salió NO recibirá** notificaciones de nuevos mensajes
- ✅ **Los demás participantes SÍ recibirán** notificaciones normalmente

### 3. Transferencia de Propiedad (Creador/Admin)

Cuando el creador del grupo sale:
- 👑 **La propiedad se transfiere automáticamente** al primer participante disponible
- 📢 **Se notifica a todos** sobre la transferencia de propiedad
- ✅ **El grupo continúa funcionando** normalmente con el nuevo propietario
- ℹ️ **Los eventos incluyen información** del nuevo propietario (`newOwnerId`, `newOwnerName`)

### 4. Eliminación Automática del Grupo

Cuando el último usuario sale del grupo:
- 🗑️ **El grupo se elimina completamente** de la base de datos
- 🗑️ **Todos los mensajes se eliminan** (no quedan rastros)
- 📢 **Se emite el evento `group_deleted`** a todos los usuarios conectados
- ✅ **Se limpia toda la data** para evitar acumulación innecesaria

### 5. Re-entrada al Grupo

Si un usuario que salió quiere volver a entrar:
- Debe ser **añadido nuevamente** por otro participante (usando `add_user_to_group`)
- Podrá ver **todos los mensajes** del grupo (incluyendo los que se enviaron mientras estaba fuera)
- Sus mensajes anteriores **siguen siendo visibles** (a menos que el grupo haya sido eliminado)

### 6. Estado de la Conversación

Después de salir:
- El grupo **ya no aparece** en `getUserConversations()` del usuario que salió
- El usuario **no puede enviar mensajes** al grupo
- El usuario **no recibe eventos** del grupo (mensajes, actualizaciones, etc.)

---

## Ejemplo Completo de Integración

```javascript
class GroupChatManager {
  constructor(socket) {
    this.socket = socket;
    this.setupLeaveGroupListeners();
  }

  setupLeaveGroupListeners() {
    // Confirmación de salida exitosa
    this.socket.on('leave_group_success', (data) => {
      this.handleLeaveSuccess(data);
    });

    // Error al salir
    this.socket.on('leave_group_error', (data) => {
      this.handleLeaveError(data);
    });

    // Otro usuario salió
    this.socket.on('user_left_group', (data) => {
      this.handleUserLeft(data);
    });

    // Actualización de participantes
    this.socket.on('group_participants_updated', (data) => {
      if (data.action === 'remove') {
        this.handleParticipantsUpdated(data);
      }
    });
  }

  leaveGroup(conversationId, userId) {
    return new Promise((resolve, reject) => {
      // Confirmar acción
      const confirmed = window.confirm(
        '¿Estás seguro de que quieres salir de este grupo? Tus mensajes permanecerán visibles.'
      );

      if (!confirmed) {
        reject(new Error('Acción cancelada'));
        return;
      }

      // Listener temporal para la respuesta
      const successHandler = (data) => {
        this.socket.off('leave_group_success', successHandler);
        this.socket.off('leave_group_error', errorHandler);
        resolve(data);
      };

      const errorHandler = (data) => {
        this.socket.off('leave_group_success', successHandler);
        this.socket.off('leave_group_error', errorHandler);
        reject(new Error(data.error));
      };

      this.socket.once('leave_group_success', successHandler);
      this.socket.once('leave_group_error', errorHandler);

      // Enviar solicitud
      this.socket.emit('leave_group', {
        conversationId,
        userId
      });
    });
  }

  handleLeaveSuccess(data) {
    // Remover de la lista de conversaciones
    this.removeConversation(data.conversationId);
    
    // Si es la conversación actual, limpiar vista
    if (this.currentConversationId === data.conversationId) {
      this.clearChatView();
    }
    
    // Mostrar notificación
    this.showNotification(
      `Saliste del grupo "${data.conversationName}"`,
      'success'
    );
    
    // Actualizar lista
    this.refreshConversationsList();
  }

  handleLeaveError(error) {
    this.showNotification(error.error, 'error');
  }

  handleUserLeft(data) {
    // Si es el grupo actual, mostrar mensaje del sistema
    if (this.currentConversationId === data.conversationId) {
      this.addSystemMessage(
        `${data.userName} salió del grupo`,
        data.timestamp
      );
      this.refreshParticipantsList();
    }
    
    // Actualizar contador en la lista
    this.updateGroupParticipantCount(
      data.conversationId,
      data.participantCount
    );
  }

  handleParticipantsUpdated(data) {
    if (this.currentConversationId === data.conversationId) {
      this.updateParticipantsList(data.participants);
      this.updateParticipantCount(data.participantCount);
    }
  }
}

// Uso
const groupManager = new GroupChatManager(socket);

// Salir del grupo
groupManager.leaveGroup('group-id', 'user-id')
  .then((result) => {
    console.log('Saliste exitosamente:', result);
  })
  .catch((error) => {
    console.error('Error:', error);
  });
```

---

## Checklist de Implementación Frontend

- [ ] Agregar botón/opción "Salir del grupo" en la UI del grupo
- [ ] Implementar confirmación antes de salir
- [ ] Escuchar evento `leave_group_success` y actualizar UI
- [ ] Escuchar evento `leave_group_error` y mostrar errores
- [ ] Escuchar evento `user_left_group` para notificar cuando otros salen
- [ ] Escuchar evento `group_participants_updated` para actualizar lista de participantes
- [ ] Remover grupo de la lista de conversaciones cuando el usuario sale
- [ ] Limpiar vista de chat si el usuario sale del grupo actual
- [ ] Actualizar contador de participantes en tiempo real
- [ ] Mostrar mensajes del sistema cuando alguien sale
- [ ] Manejar caso de re-entrada al grupo (si aplica)

---

## Nuevo Evento: `group_deleted`

**Descripción**: Se emite cuando un grupo es eliminado porque quedó vacío

**Datos recibidos**:
```typescript
{
  conversationId: string;
  conversationName: string;
  timestamp: string;
}
```

**Ejemplo de manejo**:
```javascript
socket.on('group_deleted', (data) => {
  console.log('Grupo eliminado:', data.conversationName);
  
  // Remover grupo de la lista
  removeGroupFromList(data.conversationId);
  
  // Si es el grupo actual, limpiar vista
  if (currentConversationId === data.conversationId) {
    currentConversationId = null;
    clearChatView();
    showEmptyState();
  }
  
  showNotification(`El grupo "${data.conversationName}" fue eliminado`);
});
```

---

## Preguntas Frecuentes

**P: ¿Los mensajes del usuario que salió se eliminan?**  
R: No, los mensajes permanecen visibles con el nombre original del usuario. **EXCEPCIÓN**: Si el usuario que sale es el último del grupo, el grupo completo y todos sus mensajes se eliminan.

**P: ¿Qué pasa si el creador del grupo sale?**  
R: La propiedad del grupo se transfiere automáticamente a otro participante. El grupo continúa funcionando normalmente.

**P: ¿Qué pasa si el último usuario sale del grupo?**  
R: El grupo se elimina completamente junto con todo su historial de mensajes. Se emite el evento `group_deleted` a todos los usuarios conectados.

**P: ¿El usuario puede volver a entrar al grupo?**  
R: Sí, pero debe ser añadido nuevamente por otro participante usando `add_user_to_group`. **EXCEPCIÓN**: Si el grupo fue eliminado (último usuario salió), no se puede volver a entrar porque el grupo ya no existe.

**P: ¿El usuario que salió puede ver los mensajes nuevos?**  
R: No, mientras esté fuera del grupo no recibirá nuevos mensajes. Si vuelve a entrar, podrá ver todo el historial (a menos que el grupo haya sido eliminado).

**P: ¿Se puede salir de una conversación privada?**  
R: No, esta funcionalidad solo aplica para grupos (`type: 'group'`).

**P: ¿Qué pasa si intento salir de un grupo del que no soy parte?**  
R: Recibirás un error: `"No eres participante de este grupo"`.

---

## Soporte

Para más información sobre otros eventos WebSocket, consulta `API_DOCUMENT.md`.

