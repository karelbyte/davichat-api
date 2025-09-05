# API de Avatares de Usuario

Esta documentación describe la funcionalidad de avatares de usuario implementada en la API de chat.

## Endpoints Disponibles

### 1. Subir/Actualizar Avatar de Usuario

**POST** `/api/users/:id/avatar`

Sube o actualiza el avatar de un usuario específico.

#### Parámetros
- `id` (string): ID del usuario
- `avatar` (file): Archivo de imagen (form-data)

#### Validaciones
- El archivo debe ser una imagen (JPEG, PNG, GIF, WebP)
- Tamaño máximo: 5MB
- El usuario debe existir en la base de datos

#### Respuesta Exitosa
```json
{
  "success": true,
  "message": "Avatar actualizado correctamente",
  "avatar": "/api/files/avatars/userId/avatar_filename.jpg"
}
```

#### Respuesta de Error
```json
{
  "statusCode": 400,
  "message": "El archivo debe ser una imagen",
  "error": "Bad Request"
}
```

### 2. Eliminar Avatar de Usuario

**DELETE** `/api/users/:id/avatar`

Elimina el avatar de un usuario específico.

#### Parámetros
- `id` (string): ID del usuario

#### Respuesta Exitosa
```json
{
  "success": true,
  "message": "Avatar eliminado correctamente"
}
```

#### Respuesta de Error
```json
{
  "statusCode": 400,
  "message": "El usuario no tiene avatar",
  "error": "Bad Request"
}
```

### 3. Obtener Avatar de Usuario

**GET** `/api/files/avatars/:userId/:fileName`

Sirve el archivo de avatar de un usuario específico.

#### Parámetros
- `userId` (string): ID del usuario
- `fileName` (string): Nombre del archivo de avatar

#### Respuesta
- Si el archivo existe: Devuelve la imagen con headers apropiados
- Si el archivo no existe: 404 Not Found

## Estructura de Almacenamiento

Los avatares se almacenan en una estructura organizada por usuario:

### Almacenamiento Local
```
uploads/
└── avatars/
    └── {userId}/
        └── avatar_{uuid}.{ext}
```

### Almacenamiento AWS S3
```
bucket/
└── avatars/
    └── {userId}/
        └── avatar_{uuid}.{ext}
```

### Almacenamiento EBS
```
/mnt/ebs-uploads/
└── avatars/
    └── {userId}/
        └── avatar_{uuid}.{ext}
```

## Características

1. **Organización por Usuario**: Cada usuario tiene su propia carpeta para avatares
2. **Eliminación Automática**: Al actualizar un avatar, se elimina automáticamente el anterior
3. **Validación de Tipos**: Solo se permiten archivos de imagen
4. **Límite de Tamaño**: Máximo 5MB por avatar
5. **Compatibilidad Multi-Storage**: Funciona con almacenamiento local, AWS S3 y EBS
6. **URLs Amigables**: Las URLs de avatares son fáciles de construir y usar

## Ejemplo de Uso desde el Frontend

### Subir Avatar
```javascript
const formData = new FormData();
formData.append('avatar', fileInput.files[0]);

fetch(`/api/users/${userId}/avatar`, {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => {
  console.log('Avatar actualizado:', data.avatar);
  // Actualizar la imagen en la UI
  document.getElementById('userAvatar').src = data.avatar;
});
```

### Eliminar Avatar
```javascript
fetch(`/api/users/${userId}/avatar`, {
  method: 'DELETE'
})
.then(response => response.json())
.then(data => {
  console.log('Avatar eliminado');
  // Mostrar avatar por defecto en la UI
  document.getElementById('userAvatar').src = '/default-avatar.png';
});
```

### Mostrar Avatar
```html
<img src="/api/files/avatars/userId/avatar_filename.jpg" 
     alt="Avatar del usuario" 
     onerror="this.src='/default-avatar.png'">
```

## Notas Importantes

1. **Campo en Base de Datos**: El campo `avatar` se agrega automáticamente a la tabla `users` en DynamoDB
2. **Limpieza Automática**: Los avatares antiguos se eliminan automáticamente al subir uno nuevo
3. **Manejo de Errores**: La API maneja graciosamente los errores de eliminación de archivos antiguos
4. **Cache**: Los avatares se sirven con headers de cache para optimizar el rendimiento
5. **Seguridad**: Solo se permiten tipos de archivo de imagen para prevenir vulnerabilidades
