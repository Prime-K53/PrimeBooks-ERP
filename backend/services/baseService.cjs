const { getDatabase } = require('../db.cjs');

class BaseService {
  constructor(db) {
    if (db) {
      this._db = db;
    }
  }

  get db() {
    return this._db || getDatabase();
  }

  /**
   * Single-organization mode: queries are no longer scoped by tenant.
   */
  _scopeSql(sql, params) {
    return { sql, params };
  }

  _run(sql, params = []) {
    const scoped = this._scopeSql(sql, params);
    return new Promise((resolve, reject) => {
      this.db.run(scoped.sql, scoped.params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  _get(sql, params = []) {
    const scoped = this._scopeSql(sql, params);
    return new Promise((resolve, reject) => {
      this.db.get(scoped.sql, scoped.params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  _all(sql, params = []) {
    const scoped = this._scopeSql(sql, params);
    return new Promise((resolve, reject) => {
      this.db.all(scoped.sql, scoped.params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  _transaction(callback) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run("BEGIN TRANSACTION", (beginErr) => {
          if (beginErr) {
            return reject(beginErr);
          }
          try {
            const result = callback();
            if (result && typeof result.then === 'function') {
              result.then((val) => {
                this.db.run("COMMIT", (commitErr) => {
                  if (commitErr) {
                    this.db.run("ROLLBACK", () => reject(commitErr));
                  } else {
                    resolve(val);
                  }
                });
              }).catch((err) => {
                this.db.run("ROLLBACK", () => reject(err));
              });
            } else {
              this.db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  this.db.run("ROLLBACK", () => reject(commitErr));
                } else {
                  resolve(result);
                }
              });
            }
          } catch (err) {
            this.db.run("ROLLBACK", () => reject(err));
          }
        });
      });
    });
  }
}

module.exports = BaseService;
