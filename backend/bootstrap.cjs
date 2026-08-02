const fs = require('fs');
const path = require('path');
const { initDb, db } = require('./db.cjs');
const BackupService = require('./services/backupService.cjs');
const licenseService = require('./services/licenseService.cjs');
const {
  storageDir,
  backupDir,
  tempDir,
  secureKeysDir,
  getDbPath,
  licensePath,
  ensureDir,
} = require('./runtimePaths.cjs');

async function bootstrap() {
  console.log('--- PRIME ERP OFFLINE BOOTSTRAP START ---');

  // 1. Ensure required directories exist
  const dirs = [
    storageDir,
    backupDir,
    tempDir,
    secureKeysDir,
  ];

  dirs.forEach(dir => {
    const existed = fs.existsSync(dir);
    ensureDir(dir);
    if (!existed) console.log(`Created directory: ${dir}`);
  });

  // 2. Machine Fingerprint & Licensing
  const fingerprint = licenseService.getFingerprint();
  console.log(`Machine Fingerprint: ${fingerprint}`);
  const license = licenseService.validateLicense();
  console.log(`[LICENSE STATUS] ${license.mode} ${license.valid ? '(Valid)' : '(Limited Access - Offline Trial)'}`);

  if (!license.valid && !fs.existsSync(licensePath)) {
    console.log('Generating auto-trial license for first run...');
    licenseService.generateTrialLicense(365); // 1 year trial for offline deployment
  }

  // 3. Database Initialization & Schema Verification
  try {
    console.log('Initializing database...');
    await initDb();
    console.log('Database initialized successfully.');
    
    // Initialize examination module schemas to ensure they're ready
    console.log('Initializing examination module schemas...');
    const examinationService = require('./services/examinationService.cjs');
    await examinationService.ensureCoreExaminationSchema();
    await examinationService.ensureExaminationSyncSchema();
    await examinationService.ensureExaminationPricingSchema();
    console.log('Examination module schemas initialized.');

     // Initialize auth schema (users table)
     console.log('Initializing auth schema...');
     const authService = require('./services/authService.cjs');
     await authService.ensureAuthSchema();
     console.log('Auth schema initialized.');

     // Initialize portal auth schema (portal_users, sessions, etc.)
     console.log('Initializing portal auth schema...');
     const portalAuthService = require('./services/portalAuthService.cjs');
     await portalAuthService.ensurePortalSchema();
     console.log('Portal auth schema initialized.');

     // Initialize referral tables
     console.log('Initializing referral tables...');
     const migrate_add_referral_tables = require('./migrations/add_referral_tables.cjs');
     await migrate_add_referral_tables();
     console.log('Referral tables initialized.');
     
     console.log('Schema verification passed.');
  } catch (err) {
    console.error('--- DATABASE CRITICAL ERROR ---');
    console.error(err);

    if (process.env.NODE_ENV === 'test') {
      throw err;
    }

    // Recovery Logic: Attempt to restore from latest backup
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.sqlite'))
        .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (backups.length > 0) {
        const latestBackup = path.join(backupDir, backups[0].name);
        console.log(`EMERGENCY RECOVERY: Restoring from ${latestBackup}...`);
        
      try {
        // Close DB connection if open
        db.close();
        
        // Rename corrupted DB for forensics
        const currentDbPath = getDbPath();
        const corruptedPath = currentDbPath + '.corrupted-' + Date.now();
        if (fs.existsSync(currentDbPath)) fs.renameSync(currentDbPath, corruptedPath);
        
        // Copy backup
        fs.copyFileSync(latestBackup, currentDbPath);
        console.log('Recovery successful. System will now exit. Please restart the application.');
        process.exit(0); 
      } catch (recoveryErr) {
        console.error('RECOVERY FAILED:', recoveryErr);
      }
      } else {
        console.error('No backups found for recovery.');
      }
    }
    process.exit(1);
  }



  // 4. Data Safety - Initial Backup
  const backupService = new BackupService(backupDir);
  await backupService.createBackup().catch(err => console.warn('Initial backup failed:', err));

  // 6. First-Run Seeding
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM schools", (err, row) => {
      if (err) {
        console.error('Error checking schools count:', err);
        return resolve(); // Continue anyway
      }
      if (row.count === 0) {
        console.log('First run detected. Seeding default data...');
        try {
          seedDefaultData();
        } catch (seedErr) {
          console.error('Failed to seed default data (non-fatal):', seedErr);
        }
      }
      console.log('--- PRIME ERP OFFLINE BOOTSTRAP COMPLETE ---');
      resolve();
    });
  });
}

function seedDefaultData() {
  db.serialize(() => {
    // Seed Schools
    const schools = [
      ['Sample Academy', 'margin-based', 0.3],
      ['City Primary', 'per-sheet', 15.0]
    ];
    for (const s of schools) {
      db.run("INSERT INTO schools (name, pricing_type, pricing_value) VALUES (?, ?, ?)", s);
    }

    // Seed Classes
    const defaultClasses = [
      "Standard 1", "Standard 2", "Standard 3", "Standard 4",
      "Standard 5", "Standard 6", "Standard 7", "Standard 8"
    ];
    for (const c of defaultClasses) {
      db.run("INSERT OR IGNORE INTO classes (name) VALUES (?)", [c]);
    }

    // Seed Subjects
    const defaultSubjects = [
      ["Agriculture", "AGRI"], ["Bible knowledge", "BK"], ["Chichewa", "CHI"],
      ["English", "ENG"], ["Expressive arts", "ARTS"], ["Life skills", "LS"],
      ["Mathematics", "MATH"], ["P / Science", "PSCI"], ["Social studies", "SS"],
      ["Ulimi Sayansi", "USAY"], ["Arts and Life", "ALIFE"], ["Social & BK", "SBK"]
    ];
    for (const s of defaultSubjects) {
      db.run("INSERT OR IGNORE INTO subjects (name, code) VALUES (?, ?)", s);
    }

    // Seed Inventory
    const materials = [
      ['INV-PAPER', 'Paper', 'Paper', 5000, 35.0],
      ['INV-TONER', 'Toner', 'Toner', 1000, 0.25]
    ];
    for (const m of materials) {
      db.run("INSERT OR IGNORE INTO inventory (id, name, material, quantity, cost_per_unit) VALUES (?, ?, ?, ?, ?)", m);
    }

    // Seed Work Centers
    const workCenters = [
      ['WC-PRN-01', 'Offset Printing Line 1', 'Primary printing facility', 45.00, 8, 'Active'],
      ['WC-BND-01', 'Perfect Binding Station', 'Paper binding and finishing', 35.00, 8, 'Active'],
      ['WC-CUT-01', 'Hydraulic Cutting Station', 'Precision paper cutting', 25.00, 8, 'Active']
    ];
    for (const wc of workCenters) {
      db.run("INSERT OR IGNORE INTO work_centers (id, name, description, hourly_rate, capacity_per_day, status) VALUES (?, ?, ?, ?, ?, ?)", wc);
    }

    // Seed Production Resources
    const resources = [
      ['RES-PRN-01', 'Heidelberg Speedmaster', 'WC-PRN-01', 'Active'],
      ['RES-BND-01', 'Horizon Binder', 'WC-BND-01', 'Active'],
      ['RES-CUT-01', 'Polar Cutter', 'WC-CUT-01', 'Active']
    ];
    for (const r of resources) {
      db.run("INSERT OR IGNORE INTO production_resources (id, name, work_center_id, status) VALUES (?, ?, ?, ?)", r);
    }

    console.log('Default data seeded (schools, classes, subjects, inventory, work centers, resources).');
  });
}

module.exports = bootstrap;
