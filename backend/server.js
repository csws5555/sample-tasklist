const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3001;
// add this
const isProduction = process.env.NODE_ENV === 'production';

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'https://your-netlify-app.netlify.app' // Replace with your actual Netlify URL
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Database setup - different paths for dev vs production
const dbPath = isProduction
  ? '/opt/render/project/src/tasks.db'
  : path.join(__dirname, 'tasks.db');
  
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    // Create tasks table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      completed BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      } else {
        console.log('Tasks table ready');
        // Insert sample data if table is empty
        db.get("SELECT COUNT(*) as count FROM tasks", (err, row) => {
          if (!err && row.count === 0) {
            const sampleTasks = [
              'Learn React',
              'Build a task app',
              'Connect to database'
            ];
            sampleTasks.forEach(task => {
              db.run("INSERT INTO tasks (text) VALUES (?)", [task]);
            });
            console.log('Sample tasks added');
          }
        });
      }
    });
  }
});

// Helper function to convert database rows to API format
const formatTask = (row) => ({
  id: row.id,
  text: row.text,
  completed: Boolean(row.completed),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

// Routes

// GET /api/tasks - Get all tasks
app.get('/api/tasks', (req, res) => {
  db.all("SELECT * FROM tasks ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
    } else {
      const tasks = rows.map(formatTask);
      res.json(tasks);
    }
  });
});

// POST /api/tasks - Create a new task
app.post('/api/tasks', (req, res) => {
  const { text } = req.body;
  
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Task text is required' });
  }

  const sql = "INSERT INTO tasks (text) VALUES (?)";
  db.run(sql, [text.trim()], function(err) {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
    } else {
      // Get the newly created task
      db.get("SELECT * FROM tasks WHERE id = ?", [this.lastID], (err, row) => {
        if (err) {
          console.error('Database error:', err);
          res.status(500).json({ error: 'Database error' });
        } else {
          res.status(201).json(formatTask(row));
        }
      });
    }
  });
});

// PUT /api/tasks/:id - Update a task
app.put('/api/tasks/:id', (req, res) => {
  const taskId = parseInt(req.params.id);
  const { text, completed } = req.body;
  
  // Build dynamic SQL based on what fields are provided
  let sql = "UPDATE tasks SET updated_at = CURRENT_TIMESTAMP";
  let params = [];
  
  if (text !== undefined) {
    sql += ", text = ?";
    params.push(text.trim());
  }
  
  if (completed !== undefined) {
    sql += ", completed = ?";
    params.push(completed ? 1 : 0);
  }
  
  sql += " WHERE id = ?";
  params.push(taskId);
  
  db.run(sql, params, function(err) {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
    } else if (this.changes === 0) {
      res.status(404).json({ error: 'Task not found' });
    } else {
      // Get the updated task
      db.get("SELECT * FROM tasks WHERE id = ?", [taskId], (err, row) => {
        if (err) {
          console.error('Database error:', err);
          res.status(500).json({ error: 'Database error' });
        } else {
          res.json(formatTask(row));
        }
      });
    }
  });
});

// DELETE /api/tasks/:id - Delete a task
app.delete('/api/tasks/:id', (req, res) => {
  const taskId = parseInt(req.params.id);
  
  db.run("DELETE FROM tasks WHERE id = ?", [taskId], function(err) {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
    } else if (this.changes === 0) {
      res.status(404).json({ error: 'Task not found' });
    } else {
      res.status(204).send();
    }
  });
});

// GET /api/stats - Get task statistics
app.get('/api/stats', (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as pending
    FROM tasks
  `;
  
  db.get(sql, (err, row) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json({
        total: row.total,
        completed: row.completed,
        pending: row.pending
      });
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    database: 'SQLite',
    dbPath: dbPath
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Database file:', dbPath);
  console.log('API endpoints:');
  console.log(`  GET    http://localhost:${PORT}/api/tasks`);
  console.log(`  POST   http://localhost:${PORT}/api/tasks`);
  console.log(`  PUT    http://localhost:${PORT}/api/tasks/:id`);
  console.log(`  DELETE http://localhost:${PORT}/api/tasks/:id`);
  console.log(`  GET    http://localhost:${PORT}/api/stats`);
  console.log(`  GET    http://localhost:${PORT}/api/health`);
});