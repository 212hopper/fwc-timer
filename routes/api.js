const express = require('express');
const router = express.Router();
const db = require('../database');

// Get all presets
router.get('/presets', (req, res) => {
  try {
    const presets = db.getAllPresets();
    res.json(presets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch presets' });
  }
});

// Get single preset
router.get('/presets/:id', (req, res) => {
  try {
    const preset = db.getPresetById(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    res.json(preset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch preset' });
  }
});

// Create preset
router.post('/presets', (req, res) => {
  try {
    const { name, description, sections } = req.body;
    if (!name || !sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ error: 'Name and at least one section are required' });
    }
    const preset = db.createPreset(name, description, sections);
    res.status(201).json(preset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create preset' });
  }
});

// Update preset
router.put('/presets/:id', (req, res) => {
  try {
    const { name, description, sections } = req.body;
    if (!name || !sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ error: 'Name and at least one section are required' });
    }
    const existing = db.getPresetById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Preset not found' });
    const preset = db.updatePreset(req.params.id, name, description, sections);
    res.json(preset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preset' });
  }
});

// Delete preset
router.delete('/presets/:id', (req, res) => {
  try {
    const existing = db.getPresetById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Preset not found' });
    db.deletePreset(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete preset' });
  }
});

// Export preset as JSON
router.get('/presets/:id/export', (req, res) => {
  try {
    const preset = db.getPresetById(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    res.setHeader('Content-Disposition', `attachment; filename="preset-${preset.name.replace(/\s+/g, '-')}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json({
      exportVersion: 1,
      name: preset.name,
      description: preset.description,
      sections: preset.sections.map(s => ({
        name: s.name,
        duration_seconds: s.duration_seconds,
        order_index: s.order_index
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export preset' });
  }
});

// Import preset from JSON
router.post('/presets/import', (req, res) => {
  try {
    const data = req.body;
    if (!data.name || !data.sections || !Array.isArray(data.sections)) {
      return res.status(400).json({ error: 'Invalid preset format' });
    }
    const preset = db.createPreset(
      data.name + ' (imported)',
      data.description || '',
      data.sections
    );
    res.status(201).json(preset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to import preset' });
  }
});

module.exports = router;