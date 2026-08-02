const fs = require('fs');
const path = require('path');
const { getDbPath } = require('../runtimePaths.cjs');
const { getDatabase } = require('../db.cjs');
const getDb = () => getDatabase();

class BackupService {
  constructor(backupDir) {
    this.backupDir = backupDir || path.join(path.dirname(getDbPath()), 'backups');
    this.maxBackups = 7; // Keep a week of daily backups

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  async createBackup() {
    const dbPath = getDbPath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDir, `backup-${timestamp}.sqlite`);

    return new Promise((resolve, reject) => {
      // Use standard fs.copyFile for SQLite backup (assuming it's not being written to at this exact millisecond)
      // For a more robust solution, one could use SQLite's .backup command via exec
      fs.copyFile(dbPath, backupPath, (err) => {
        if (err) {
          console.error('Backup failed:', err);
          return reject(err);
        }
        console.log(`Backup created: ${backupPath}`);
        this.cleanupOldBackups();
        resolve(backupPath);
      });
    });
  }

  cleanupOldBackups() {
    fs.readdir(this.backupDir, (err, files) => {
      if (err) return;

      const backups = files
        .filter(f => f.startsWith('backup-') && f.endsWith('.sqlite'))
        .map(f => ({ name: f, time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);
        toDelete.forEach(f => {
          fs.unlinkSync(path.join(this.backupDir, f.name));
          console.log(`Deleted old backup: ${f.name}`);
        });
      }
    });
  }

  async verifyIntegrity(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    return stats.size > 0;
  }

  async exportData(exportDir = null) {
    const dir = exportDir || path.join(this.backupDir, 'export');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tables = [
      'customers', 'inventory', 'sales', 'invoices', 'audit_logs',
      'bank_accounts', 'bank_transactions', 'chart_of_accounts',
      'ledger_entries', 'suppliers', 'purchase_orders', 'employees',
      'payroll_runs', 'documents', 'examination_batches',
      'examination_classes', 'examination_subjects'
    ];

    for (const table of tables) {
      try {
        const rows = await new Promise((resolve, reject) => {
          getDb().all(
            `SELECT * FROM "${table}"`,
            [],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });
        if (rows.length > 0) {
          const filePath = path.join(dir, `${table}.json`);
          fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
        }
      } catch (err) {
        console.warn(`[BackupService] Could not export table ${table}: ${err.message}`);
      }
    }

    return { path: dir};
  }
}

module.exports = BackupService;
