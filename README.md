# Roadmapper - Herramienta Web de Roadmaps

Recreación moderna y multiplataforma de Roadmapper como aplicación web colaborativa.

## Características

- Vista de calendario horizontal con zoom ajustable
- Tareas como barras arrastrables y redimensionables
- Campo de estimación editable (texto libre)
- Sincronización en tiempo real via WebSockets (Socket.io)
- Base de datos SQLite persistente
- Interfaz minimalista inspirada en Ableton

## Requisitos previos

- Node.js (v18 o superior)
- npm

## Instalación

```bash
# Instalar dependencias del backend
cd backend
npm install

# Instalar dependencias del frontend
cd ../frontend
npm install
```

## Desarrollo

Para ejecutar en modo desarrollo (requiere dos terminales):

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

El frontend estará disponible en http://localhost:5173 y el backend en http://localhost:3001. El proxy de Vite redirige las llamadas API y WebSocket al backend automáticamente.

## Producción

```bash
# Construir el frontend
cd frontend
npm run build

# Ejecutar el backend (sirve los archivos estáticos del frontend)
cd ../backend
npm run build
npm start
```

Accede desde cualquier dispositivo de la misma red: http://<ip-del-servidor>:3001

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/tasks | Obtener todas las tareas |
| POST | /api/tasks | Crear una nueva tarea |
| PUT | /api/tasks/:id | Actualizar una tarea |
| DELETE | /api/tasks/:id | Eliminar una tarea |

## WebSocket Events

- `task-created` - Emitida cuando se crea una tarea
- `task-updated` - Emitida cuando se actualiza una tarea
- `task-deleted` - Emitida cuando se elimina una tarea (payload: id)

## Estructura del proyecto

```
TestRoadmap/
├── backend/
│   ├── src/
│   │   └── index.ts          # Servidor Express + SQLite + Socket.io
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Componente principal con toda la UI
│   │   ├── main.tsx           # Entry point de React
│   │   ├── index.css          # Estilos TailwindCSS
│   │   └── types/
│   │       └── Task.ts        # Tipo TypeScript compartido
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── postcss.config.js
└── README.md
```

## Tecnologías

- **Backend:** Node.js, Express, SQLite (better-sqlite3), Socket.io
- **Frontend:** React, TypeScript, Vite, TailwindCSS, date-fns