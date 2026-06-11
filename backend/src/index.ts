import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../../frontend/dist')));

const db = new Database(path.join(__dirname, '../roadmapper.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    estimate TEXT
  )
`);

app.get('/api/tasks', (_req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks').all();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { name, start_date, end_date, estimate } = req.body;
    const stmt = db.prepare(
      'INSERT INTO tasks (name, start_date, end_date, estimate) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(name, start_date, end_date, estimate || null);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);

    io.emit('task-created', task);

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Error creating task' });
  }
});

app.put('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, estimate } = req.body;
    const stmt = db.prepare(
      'UPDATE tasks SET name = ?, start_date = ?, end_date = ?, estimate = ? WHERE id = ?'
    );
    stmt.run(name, start_date, end_date, estimate || null, id);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

    io.emit('task-updated', task);

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Error updating task' });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

    io.emit('task-deleted', parseInt(id));

    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting task' });
  }
});

app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export { app, server, io };