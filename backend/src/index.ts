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
    estimate TEXT,
    color TEXT DEFAULT '#4caf50',
    status TEXT DEFAULT 'pendiente'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id INTEGER NOT NULL,
    depends_on_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, depends_on_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`);

const migrateTasks = () => {
  const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('color')) {
    db.exec("ALTER TABLE tasks ADD COLUMN color TEXT DEFAULT '#4caf50'");
  }
  if (!colNames.includes('status')) {
    db.exec("ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'pendiente'");
  }
};
migrateTasks();

app.get('/api/tasks', (_req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks').all() as any[];
    const deps = db.prepare('SELECT * FROM task_dependencies').all() as { task_id: number; depends_on_id: number }[];
    const tasksWithDeps = tasks.map(t => ({
      ...t,
      dependencies: deps.filter(d => d.task_id === t.id).map(d => d.depends_on_id),
    }));
    res.json(tasksWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { name, start_date, end_date, estimate, color, status } = req.body;
    const stmt = db.prepare(
      'INSERT INTO tasks (name, start_date, end_date, estimate, color, status) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(name, start_date, end_date, estimate || null, color || '#4caf50', status || 'pendiente');
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
    const { name, start_date, end_date, estimate, color, status } = req.body;
    const stmt = db.prepare(
      'UPDATE tasks SET name = ?, start_date = ?, end_date = ?, estimate = ?, color = ?, status = ? WHERE id = ?'
    );
    stmt.run(name, start_date, end_date, estimate || null, color || '#4caf50', status || 'pendiente', id);
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
    db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_id = ?').run(id, id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

    io.emit('task-deleted', parseInt(id));

    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting task' });
  }
});

app.post('/api/tasks/:id/dependencies', (req, res) => {
  try {
    const { id } = req.params;
    const { depends_on_id } = req.body;
    if (parseInt(id) === depends_on_id) {
      res.status(400).json({ error: 'Task cannot depend on itself' });
      return;
    }
    const existing = db.prepare('SELECT * FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?').get(id, depends_on_id);
    if (!existing) {
      db.prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)').run(id, depends_on_id);
    }
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(id) as { depends_on_id: number }[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id) };
    io.emit('task-updated', taskWithDeps);
    res.json(taskWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error adding dependency' });
  }
});

app.delete('/api/tasks/:id/dependencies/:depId', (req, res) => {
  try {
    const { id, depId } = req.params;
    db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?').run(id, depId);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(id) as { depends_on_id: number }[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id) };
    io.emit('task-updated', taskWithDeps);
    res.json(taskWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error removing dependency' });
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