import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import path from 'path';
import { create } from 'jsondiffpatch';

const app = express();
const FORGEJO_TOKEN = 'gto_k6skuazpd6n3v354te7yjhsyvr7yzq4lgc4af722qkfpcigfu44a';
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

app.use(cors());
app.use(express.json({ limit: '250mb' }));

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

db.exec(`
  CREATE TABLE IF NOT EXISTS task_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#607d8b',
    collapsed INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS task_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_data TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS task_forgejo_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    item_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS task_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    change_type TEXT NOT NULL,
    diff TEXT,
    snapshot TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`);

const migrateTasks = () => {
  const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('group_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN group_id INTEGER REFERENCES task_groups(id) ON DELETE SET NULL");
  }
  if (!colNames.includes('position')) {
    db.exec("ALTER TABLE tasks ADD COLUMN position INTEGER DEFAULT 0");
  }
  if (!colNames.includes('color')) {
    db.exec("ALTER TABLE tasks ADD COLUMN color TEXT DEFAULT '#4caf50'");
  }
  if (!colNames.includes('status')) {
    db.exec("ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'pendiente'");
  }
  if (!colNames.includes('notes')) {
    db.exec("ALTER TABLE tasks ADD COLUMN notes TEXT DEFAULT ''");
  }

  const groupCols = db.prepare("PRAGMA table_info(task_groups)").all() as { name: string }[];
  const groupColNames = groupCols.map(c => c.name);
  if (!groupColNames.includes('position')) {
    db.exec("ALTER TABLE task_groups ADD COLUMN position INTEGER DEFAULT 0");
  }

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_attachments'").all();
  const groupTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_groups'").all();
  if (groupTables.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#607d8b',
        collapsed INTEGER DEFAULT 0,
        position INTEGER DEFAULT 0
      )
    `);
  }
  if (tables.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);
  }
  const forgejoTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_forgejo_links'").all();
  if (forgejoTables.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_forgejo_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        item_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);
  }
};
migrateTasks();

app.get('/api/groups', (_req, res) => {
  try {
    const groups = db.prepare('SELECT * FROM task_groups').all();
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching groups' });
  }
});

app.post('/api/groups', (req, res) => {
  try {
    const { name, color } = req.body;
    const stmt = db.prepare('INSERT INTO task_groups (name, color) VALUES (?, ?)');
    const result = stmt.run(name, color || '#607d8b');
    const group = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(result.lastInsertRowid);
    io.emit('group-created', group);
    res.status(201).json(group);
  } catch (error) {
    res.status(500).json({ error: 'Error creating group' });
  }
});

app.put('/api/groups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, collapsed } = req.body;
    const existing = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    db.prepare('UPDATE task_groups SET name = ?, color = ?, collapsed = ? WHERE id = ?')
      .run(name ?? existing.name, color ?? existing.color, collapsed ?? existing.collapsed, id);
    const group = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id);
    io.emit('group-updated', group);
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: 'Error updating group' });
  }
});

app.delete('/api/groups/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE tasks SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM task_groups WHERE id = ?').run(id);
    io.emit('group-deleted', parseInt(id));
    res.json({ message: 'Group deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting group' });
  }
});

const getTaskWithRelations = (id: string | number) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
  if (!task) return null;
  const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(id) as { depends_on_id: number }[];
  const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ?').all(id) as any[];
  const forgejoLinks = db.prepare('SELECT * FROM task_forgejo_links WHERE task_id = ?').all(id) as any[];
  return {
    ...task,
    dependencies: deps.map(d => d.depends_on_id),
    attachments,
    forgejo_links: forgejoLinks
  };
};

const saveTaskVersion = (taskId: number, changeType: string, diff: any, snapshot: any, userId?: string) => {
  const stmt = db.prepare('INSERT INTO task_versions (task_id, user_id, change_type, diff, snapshot) VALUES (?, ?, ?, ?, ?)');
  stmt.run(taskId, userId || null, changeType, diff ? JSON.stringify(diff) : null, JSON.stringify(snapshot));
};

const diffpatch = create({
  objectHash: (obj: any) => obj && obj.id ? String(obj.id) : JSON.stringify(obj),
});

app.get('/api/tasks', (_req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks').all() as any[];
    const deps = db.prepare('SELECT * FROM task_dependencies').all() as { task_id: number; depends_on_id: number }[];
    const attachments = db.prepare('SELECT * FROM task_attachments').all() as any[];
    const forgejoLinks = db.prepare('SELECT * FROM task_forgejo_links').all() as any[];
    const tasksWithDeps = tasks.map(t => ({
      ...t,
      dependencies: deps.filter(d => d.task_id === t.id).map(d => d.depends_on_id),
      attachments: attachments.filter(a => a.task_id === t.id),
      forgejo_links: forgejoLinks.filter(f => f.task_id === t.id),
    }));
    res.json(tasksWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { name, start_date, end_date, estimate, color, status, notes, group_id } = req.body;
    const stmt = db.prepare(
      'INSERT INTO tasks (name, start_date, end_date, estimate, color, status, notes, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(name, start_date, end_date, estimate || null, color || '#4caf50', status || 'pendiente', notes || '', group_id || null);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid) as any;
    const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(result.lastInsertRowid) as { depends_on_id: number }[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id), attachments: [], forgejo_links: [] };

    io.emit('task-created', taskWithDeps);

    try {
      const diff = diffpatch.diff(null, taskWithDeps);
      saveTaskVersion(result.lastInsertRowid as number, 'create', diff, taskWithDeps);
    } catch (e) {}

    res.status(201).json(taskWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error creating task' });
  }
});

app.put('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, estimate, color, status, notes, group_id } = req.body;
    const before = getTaskWithRelations(id);
    const stmt = db.prepare(
      'UPDATE tasks SET name = ?, start_date = ?, end_date = ?, estimate = ?, color = ?, status = ?, notes = ?, group_id = ? WHERE id = ?'
    );
    stmt.run(name, start_date, end_date, estimate || null, color || '#4caf50', status || 'pendiente', notes || '', group_id || null, id);
    const taskWithDeps = getTaskWithRelations(id);

    if (taskWithDeps) {
      io.emit('task-updated', taskWithDeps);
      try {
        const diff = diffpatch.diff(before, taskWithDeps);
        saveTaskVersion(parseInt(String(id)), 'update', diff, taskWithDeps);
      } catch (e) {}
    }

    res.json(taskWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error updating task' });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const snapshot = getTaskWithRelations(id);
    try {
      const diff = snapshot ? diffpatch.diff(snapshot, null) : null;
      if (snapshot) saveTaskVersion(parseInt(String(id)), 'delete', diff, snapshot);
    } catch (e) {}
    db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_id = ?').run(id, id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

    io.emit('task-deleted', parseInt(id));

    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting task' });
  }
});

app.get('/api/tasks/:id/versions', (req, res) => {
  try {
    const { id } = req.params;
    const rows = db.prepare('SELECT id, task_id, user_id, timestamp, change_type FROM task_versions WHERE task_id = ? ORDER BY timestamp DESC').all(id);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching versions' });
  }
});

app.get('/api/tasks/versions/all', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM task_versions ORDER BY timestamp DESC LIMIT 200').all() as any[];
    const parsed = rows.map(r => ({
      ...r,
      diff: r.diff ? JSON.parse(r.diff) : null,
      snapshot: r.snapshot ? JSON.parse(r.snapshot) : null,
    }));
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching global versions' });
  }
});

app.get('/api/tasks/:id/versions/:vid', (req, res) => {
  try {
    const { id, vid } = req.params;
    const v = db.prepare('SELECT * FROM task_versions WHERE id = ? AND task_id = ?').get(vid, id) as any;
    if (!v) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    const out = {
      id: v.id,
      task_id: v.task_id,
      user_id: v.user_id,
      timestamp: v.timestamp,
      change_type: v.change_type,
      diff: v.diff ? JSON.parse(v.diff) : null,
      snapshot: v.snapshot ? JSON.parse(v.snapshot) : null
    };
    res.json(out);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching version' });
  }
});

app.post('/api/tasks/:id/versions/:vid/restore', (req, res) => {
  try {
    const { id, vid } = req.params;
    const v = db.prepare('SELECT * FROM task_versions WHERE id = ? AND task_id = ?').get(vid, id) as any;
    if (!v) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    const snapshot = JSON.parse(v.snapshot) as any;
    db.transaction(() => {
      const t = snapshot;
      const upsert = db.prepare('REPLACE INTO tasks (id, name, start_date, end_date, estimate, color, status, notes, group_id, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      upsert.run(t.id, t.name, t.start_date, t.end_date, t.estimate || null, t.color || '#4caf50', t.status || 'pendiente', t.notes || '', t.group_id || null, t.position ?? 0);
      db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_id = ?').run(t.id, t.id);
      if (Array.isArray(t.dependencies)) {
        const insDep = db.prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)');
        t.dependencies.forEach((d: number) => insDep.run(t.id, d));
      }
      db.prepare('DELETE FROM task_attachments WHERE task_id = ?').run(t.id);
      if (Array.isArray(t.attachments)) {
        const insAtt = db.prepare('INSERT INTO task_attachments (task_id, file_name, file_type, file_data) VALUES (?, ?, ?, ?)');
        t.attachments.forEach((a: any) => insAtt.run(t.id, a.file_name, a.file_type, a.file_data));
      }
      db.prepare('DELETE FROM task_forgejo_links WHERE task_id = ?').run(t.id);
      if (Array.isArray(t.forgejo_links)) {
        const insLink = db.prepare('INSERT INTO task_forgejo_links (task_id, type, title, url, repo_name, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        t.forgejo_links.forEach((l: any) => insLink.run(t.id, l.type, l.title, l.url, l.repo_name, l.item_id || null, l.created_at || null));
      }
    })();

    const task = getTaskWithRelations(id);
    if (task) {
      try {
        saveTaskVersion(parseInt(String(id)), 'restore', { from_version: vid }, task);
      } catch (e) {}
      io.emit('task-updated', task);
    }

    res.json({ message: 'Task restored', task });
  } catch (error) {
    res.status(500).json({ error: 'Error restoring version' });
  }
});

app.post('/api/tasks/:id/attachments', (req, res) => {
  try {
    const { id } = req.params;
    const { file_name, file_type, file_data } = req.body;
    const stmt = db.prepare(
      'INSERT INTO task_attachments (task_id, file_name, file_type, file_data) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(id, file_name, file_type, file_data);
    const attachment = db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(result.lastInsertRowid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(id) as { depends_on_id: number }[];
    const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ?').all(id) as any[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id), attachments };
    io.emit('task-updated', taskWithDeps);
    res.status(201).json({ attachment, task: taskWithDeps });
  } catch (error) {
    res.status(500).json({ error: 'Error creating attachment' });
  }
});

app.delete('/api/attachments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const attachment = db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(id) as any;
    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }
    db.prepare('DELETE FROM task_attachments WHERE id = ?').run(id);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(attachment.task_id) as any;
    const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(attachment.task_id) as { depends_on_id: number }[];
    const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ?').all(attachment.task_id) as any[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id), attachments };
    io.emit('task-updated', taskWithDeps);
    res.json({ message: 'Attachment deleted', task: taskWithDeps });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting attachment' });
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
    const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ?').all(id) as any[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id), attachments };
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
    const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ?').all(id) as any[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id), attachments };
    io.emit('task-updated', taskWithDeps);
    res.json(taskWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error removing dependency' });
  }
});

app.post('/api/tasks/move', (req, res) => {
  try {
    const { task_id, group_id, position } = req.body;
    db.prepare('UPDATE tasks SET group_id = ?, position = ? WHERE id = ?').run(group_id || null, position ?? 0, task_id);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id) as any;
    const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(task_id) as { depends_on_id: number }[];
    const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ?').all(task_id) as any[];
    const taskWithDeps = { ...task, dependencies: deps.map(d => d.depends_on_id), attachments };
    io.emit('task-updated', taskWithDeps);
    res.json(taskWithDeps);
  } catch (error) {
    res.status(500).json({ error: 'Error moving task' });
  }
});

app.post('/api/tasks/reorder', (req, res) => {
  try {
    const { ordered_ids } = req.body;
    const stmt = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    const tx = db.transaction((ids: number[]) => {
      ids.forEach((id, idx) => stmt.run(idx, id));
    });
    tx(ordered_ids);
    res.json({ message: 'Tasks reordered' });
  } catch (error) {
    res.status(500).json({ error: 'Error reordering tasks' });
  }
});

app.get('/api/project/export', (_req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks').all();
    const groups = db.prepare('SELECT * FROM task_groups').all();
    const dependencies = db.prepare('SELECT * FROM task_dependencies').all();
    const attachments = db.prepare('SELECT * FROM task_attachments').all();
    const forgejo_links = db.prepare('SELECT * FROM task_forgejo_links').all();
    res.json({ tasks, groups, dependencies, attachments, forgejo_links });
  } catch (error) {
    res.status(500).json({ error: 'Error exporting project' });
  }
});

app.post('/api/project/import', (req, res) => {
  try {
    const { tasks, groups, dependencies, attachments, forgejo_links } = req.body;
    if (!Array.isArray(tasks) || !Array.isArray(groups)) {
      res.status(400).json({ error: 'Invalid project data' });
      return;
    }

    const runImport = db.transaction(() => {
      db.prepare('DELETE FROM task_attachments').run();
      db.prepare('DELETE FROM task_dependencies').run();
      db.prepare('DELETE FROM task_forgejo_links').run();
      db.prepare('DELETE FROM tasks').run();
      db.prepare('DELETE FROM task_groups').run();

      const insertGroup = db.prepare(
        'INSERT INTO task_groups (id, name, color, collapsed, position) VALUES (?, ?, ?, ?, ?)'
      );
      groups.forEach((g: any) => {
        insertGroup.run(g.id, g.name, g.color || '#607d8b', g.collapsed ?? 0, g.position ?? 0);
      });

      const insertTask = db.prepare(
        'INSERT INTO tasks (id, name, start_date, end_date, estimate, color, status, notes, group_id, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      tasks.forEach((t: any) => {
        insertTask.run(
          t.id,
          t.name,
          t.start_date,
          t.end_date,
          t.estimate || null,
          t.color || '#4caf50',
          t.status || 'pendiente',
          t.notes || '',
          t.group_id || null,
          t.position ?? 0
        );
      });

      if (Array.isArray(dependencies)) {
        const insertDep = db.prepare(
          'INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)'
        );
        dependencies.forEach((d: any) => {
          insertDep.run(d.task_id, d.depends_on_id);
        });
      }

      if (Array.isArray(attachments)) {
        const insertAtt = db.prepare(
          'INSERT INTO task_attachments (id, task_id, file_name, file_type, file_data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        attachments.forEach((a: any) => {
          insertAtt.run(a.id, a.task_id, a.file_name, a.file_type, a.file_data, a.created_at || null);
        });
      }

      if (Array.isArray(forgejo_links)) {
        const insertLink = db.prepare(
          'INSERT INTO task_forgejo_links (id, task_id, type, title, url, repo_name, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        forgejo_links.forEach((l: any) => {
          insertLink.run(l.id, l.task_id, l.type, l.title, l.url, l.repo_name, l.item_id || null, l.created_at || null);
        });
      }
    });

    runImport();

    io.emit('project-imported');

    res.json({ message: 'Project imported successfully' });
  } catch (error) {
    console.error('Error importing project:', error);
    res.status(500).json({ error: 'Error importing project' });
  }
});

app.post('/api/project/clear', (_req, res) => {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM task_attachments').run();
      db.prepare('DELETE FROM task_dependencies').run();
      db.prepare('DELETE FROM task_forgejo_links').run();
      db.prepare('DELETE FROM tasks').run();
      db.prepare('DELETE FROM task_groups').run();
    })();
    io.emit('project-imported');
    res.json({ message: 'Project cleared successfully' });
  } catch (error) {
    console.error('Error clearing project:', error);
    res.status(500).json({ error: 'Error clearing project' });
  }
});

app.post('/api/tasks/:id/forgejo-links', (req, res) => {
  try {
    const { id } = req.params;
    const { type, title, url, repo_name, item_id } = req.body;
    const stmt = db.prepare(
      'INSERT INTO task_forgejo_links (task_id, type, title, url, repo_name, item_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(id, type, title, url, repo_name, item_id || null);
    const link = db.prepare('SELECT * FROM task_forgejo_links WHERE id = ?').get(result.lastInsertRowid);
    const task = getTaskWithRelations(id);
    if (task) {
      io.emit('task-updated', task);
    }
    res.status(201).json({ link, task });
  } catch (error) {
    res.status(500).json({ error: 'Error creating forgejo link' });
  }
});

app.delete('/api/forgejo-links/:id', (req, res) => {
  try {
    const { id } = req.params;
    const link = db.prepare('SELECT * FROM task_forgejo_links WHERE id = ?').get(id) as any;
    if (!link) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    db.prepare('DELETE FROM task_forgejo_links WHERE id = ?').run(id);
    const task = getTaskWithRelations(link.task_id);
    if (task) {
      io.emit('task-updated', task);
    }
    res.json({ message: 'Forgejo link deleted', task });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting forgejo link' });
  }
});

app.get('/api/forgejo/repos', async (req, res) => {
  try {
    const token = req.headers['x-forgejo-token'] || FORGEJO_TOKEN;
    if (!token) {
      res.status(401).json({ error: 'Token de acceso de Forgejo requerido' });
      return;
    }
    const headers: Record<string, string> = {
      'Authorization': `token ${token}`
    };
    const response = await fetch('http://100.80.155.128:3000/api/v1/user/repos?limit=100', { headers });
    if (!response.ok) {
      res.status(response.status).json({ error: 'Error al obtener repositorios de Forgejo' });
      return;
    }
    const repos = await response.json() as any[];
    const orgsResponse = await fetch('http://100.80.155.128:3000/api/v1/user/orgs', { headers });
    if (orgsResponse.ok) {
      const orgs = await orgsResponse.json() as any[];
      for (const org of orgs) {
        const orgName = org.username || org.name;
        if (orgName) {
          const orgReposResponse = await fetch(`http://100.80.155.128:3000/api/v1/orgs/${orgName}/repos?limit=100`, { headers });
          if (orgReposResponse.ok) {
            const orgRepos = await orgReposResponse.json() as any[];
            for (const repo of orgRepos) {
              if (!repos.some(r => r.id === repo.id)) {
                repos.push(repo);
              }
            }
          }
        }
      }
    }
    res.json(repos);
  } catch (error) {
    res.status(500).json({ error: 'Servidor Forgejo inaccesible' });
  }
});

app.get('/api/forgejo/search-repos', async (req, res) => {
  try {
    const q = req.query.q || '';
    const token = req.headers['x-forgejo-token'] || FORGEJO_TOKEN;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    const response = await fetch(`http://100.80.155.128:3000/api/v1/repos/search?limit=20&q=${encodeURIComponent(String(q))}`, { headers });
    if (!response.ok) {
      res.status(response.status).json({ error: 'Error fetching from Forgejo' });
      return;
    }
    const data = await response.json() as any;
    res.json(data.data || []);
  } catch (error) {
    res.status(500).json({ error: 'Forgejo server unreachable' });
  }
});

app.get('/api/forgejo/repo-issues', async (req, res) => {
  try {
    const { owner, repo } = req.query;
    if (!owner || !repo) {
      res.status(400).json({ error: 'Missing owner or repo parameter' });
      return;
    }
    const token = req.headers['x-forgejo-token'] || FORGEJO_TOKEN;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    const response = await fetch(`http://100.80.155.128:3000/api/v1/repos/${owner}/${repo}/issues?state=all&limit=50`, { headers });
    if (!response.ok) {
      res.status(response.status).json({ error: 'Error fetching issues from Forgejo' });
      return;
    }
    const data = await response.json() as any[];
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Forgejo server unreachable' });
  }
});

app.get('/api/forgejo/resolve-url', async (req, res) => {
  try {
    const urlStr = req.query.url;
    if (!urlStr) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }
    const parsed = new URL(String(urlStr));
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      res.status(400).json({ error: 'Invalid URL path' });
      return;
    }
    const [owner, repo, section, id] = pathParts;
    const token = req.headers['x-forgejo-token'] || FORGEJO_TOKEN;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    let type: 'repo' | 'issue' | 'pr' | 'commit' = 'repo';
    let title = `${owner}/${repo}`;
    let item_id: string | null = null;

    if (section === 'issues' && id) {
      type = 'issue';
      item_id = id;
      const resp = await fetch(`http://100.80.155.128:3000/api/v1/repos/${owner}/${repo}/issues/${id}`, { headers });
      if (resp.ok) {
        const issue = await resp.json() as any;
        title = issue.title;
        if (issue.pull_request) {
          type = 'pr';
        }
      }
    } else if (section === 'pulls' && id) {
      type = 'pr';
      item_id = id;
      const resp = await fetch(`http://100.80.155.128:3000/api/v1/repos/${owner}/${repo}/issues/${id}`, { headers });
      if (resp.ok) {
        const issue = await resp.json() as any;
        title = issue.title;
      }
    } else if (section === 'commit' && id) {
      type = 'commit';
      item_id = id;
      const resp = await fetch(`http://100.80.155.128:3000/api/v1/repos/${owner}/${repo}/git/commits/${id}`, { headers });
      if (resp.ok) {
        const commit = await resp.json() as any;
        title = (commit.message || '').split('\n')[0] || `Commit ${id.slice(0, 7)}`;
      }
    } else {
      const resp = await fetch(`http://100.80.155.128:3000/api/v1/repos/${owner}/${repo}`, { headers });
      if (resp.ok) {
        const repository = await resp.json() as any;
        title = repository.full_name || repository.name;
      }
    }

    res.json({
      type,
      title,
      url: String(urlStr),
      repo_name: `${owner}/${repo}`,
      item_id
    });
  } catch (error) {
    res.status(500).json({ error: 'Forgejo server unreachable or invalid URL' });
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