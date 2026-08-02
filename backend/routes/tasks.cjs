const express = require('express');
const router = express.Router();
const { db } = require('../db.cjs');
const { sendSafeError } = require('../utils/errors.cjs');
const { validateBody, taskSchemas } = require('../middleware/validation.cjs');

/**
 * @route   GET /api/tasks
 * @desc    Get all tasks
 */
router.get('/', (req, res) => {
  db.all('SELECT * FROM tasks ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      console.error('[Tasks] Failed to get tasks:', err);
      return res.status(500).json({ error: 'Failed to retrieve tasks' });
    }
    res.json(rows.map(r => ({
      ...r,
      completed: !!r.completed,
      hasAlarm: !!r.has_alarm,
      reminderDate: r.reminder_date || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    })));
  });
});

/**
 * @route   POST /api/tasks
 * @desc    Create a new task
 */
router.post('/', validateBody(taskSchemas.create), (req, res) => {
  const {
    title, description, notes, assignedTo, dueDate,
    status, priority, hasAlarm, reminderDate, category,
    relatedEntityType, relatedEntityId
  } = req.body;
  const id = `TASK-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.run(`INSERT INTO tasks (
    id, title, description, notes, assigned_to, due_date,
    status, priority, has_alarm, reminder_date, category,
    related_entity_type, related_entity_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?, ?)`,
    [id, title, description || '', notes || '', assignedTo || '', dueDate || '', status || 'Pending', priority || 'Medium', hasAlarm ? 1 : 0, reminderDate || null, category || null, relatedEntityType || null, relatedEntityId || null, now, now],
    function(err) {
      if (err) {
        console.error('[Tasks] Failed to create task:', err);
        return res.status(500).json({ error: 'Failed to create task' });
      }
      res.status(201).json({
        id, title, description: description || '', notes: notes || '',
        assignedTo: assignedTo || '', dueDate: dueDate || '',
        status: status || 'Pending', priority: priority || 'Medium',
        hasAlarm: !!hasAlarm, reminderDate: reminderDate || null,
        category: category || null,
        relatedEntityType: relatedEntityType || null,
        relatedEntityId: relatedEntityId || null, createdAt: now, updatedAt: now
      });
    }
  );
});

/**
 * @route   PUT /api/tasks/:id
 * @desc    Update an existing task
 */
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const {
    title, description, notes, assignedTo, dueDate,
    status, priority, hasAlarm, reminderDate, category,
    relatedEntityType, relatedEntityId
  } = req.body;
  const now = new Date().toISOString();

  db.run(`UPDATE tasks SET
    title = COALESCE(?, title),
    description = COALESCE(?, description),
    notes = COALESCE(?, notes),
    assigned_to = COALESCE(?, assigned_to),
    due_date = COALESCE(?, due_date),
    status = COALESCE(?, status),
    priority = COALESCE(?, priority),
    has_alarm = COALESCE(?, has_alarm),
    reminder_date = COALESCE(?, reminder_date),
    category = COALESCE(?, category),
    related_entity_type = COALESCE(?, related_entity_type),
    related_entity_id = COALESCE(?, related_entity_id),
    updated_at = ?
    WHERE id = ?`,
    [title, description, notes, assignedTo, dueDate, status, priority, hasAlarm !== undefined ? (hasAlarm ? 1 : 0) : undefined, reminderDate, category, relatedEntityType, relatedEntityId, now, id],
    function(err) {
      if (err) {
        console.error('[Tasks] Failed to update task:', err);
        return res.status(500).json({ error: 'Failed to update task' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json({ success: true, updatedAt: now });
    }
  );
});

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Delete a task
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM tasks WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('[Tasks] Failed to delete task:', err);
      return res.status(500).json({ error: 'Failed to delete task' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true });
  });
});

module.exports = router;
