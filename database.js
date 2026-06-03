const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join('/app/data', 'vog-timing.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initialise();
  }
  return db;
}

function initialise() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      name TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      order_index INTEGER NOT NULL,
      FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
    );
  `);
}

// ── Presets ──────────────────────────────────────────────────────────────────

function getAllPresets() {
  const database = getDb();
  const presets = database.prepare(`
    SELECT * FROM presets ORDER BY updated_at DESC
  `).all();

  return presets.map(p => ({
    ...p,
    sections: getSectionsForPreset(p.id)
  }));
}

function getPresetById(id) {
  const database = getDb();
  const preset = database.prepare('SELECT * FROM presets WHERE id = ?').get(id);
  if (!preset) return null;
  return {
    ...preset,
    sections: getSectionsForPreset(id)
  };
}

function createPreset(name, description, sections) {
  const database = getDb();
  const id = uuidv4();
  const now = Date.now();

  const insertPreset = database.prepare(`
    INSERT INTO presets (id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertSection = database.prepare(`
    INSERT INTO sections (id, preset_id, name, duration_seconds, order_index)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = database.transaction(() => {
    insertPreset.run(id, name, description || '', now, now);
    sections.forEach((section, index) => {
      insertSection.run(uuidv4(), id, section.name, section.duration_seconds, index);
    });
  });

  transaction();
  return getPresetById(id);
}

function updatePreset(id, name, description, sections) {
  const database = getDb();
  const now = Date.now();

  const updatePresetStmt = database.prepare(`
    UPDATE presets SET name = ?, description = ?, updated_at = ? WHERE id = ?
  `);

  const deleteSections = database.prepare('DELETE FROM sections WHERE preset_id = ?');

  const insertSection = database.prepare(`
    INSERT INTO sections (id, preset_id, name, duration_seconds, order_index)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = database.transaction(() => {
    updatePresetStmt.run(name, description || '', now, id);
    deleteSections.run(id);
    sections.forEach((section, index) => {
      insertSection.run(uuidv4(), id, section.name, section.duration_seconds, index);
    });
  });

  transaction();
  return getPresetById(id);
}

function deletePreset(id) {
  const database = getDb();
  database.prepare('DELETE FROM presets WHERE id = ?').run(id);
}

function getSectionsForPreset(presetId) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM sections WHERE preset_id = ? ORDER BY order_index ASC
  `).all(presetId);
}

module.exports = {
  getAllPresets,
  getPresetById,
  createPreset,
  updatePreset,
  deletePreset
};