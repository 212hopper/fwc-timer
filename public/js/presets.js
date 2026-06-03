(() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let allPresets = [];
  let editingId = null;
  let pendingDeleteId = null;
  let dragSrcIndex = null;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const headerTitle          = document.getElementById('headerTitle');
  const headerInstance       = document.getElementById('headerInstance');
  const presetSidebarList    = document.getElementById('presetSidebarList');
  const newPresetBtn         = document.getElementById('newPresetBtn');
  const editorEmpty          = document.getElementById('editorEmpty');
  const editorForm           = document.getElementById('editorForm');
  const editorTitle          = document.getElementById('editorTitle');
  const editingPresetId      = document.getElementById('editingPresetId');
  const presetName           = document.getElementById('presetName');
  const presetDescription    = document.getElementById('presetDescription');
  const sectionRows          = document.getElementById('sectionRows');
  const addSectionBtn        = document.getElementById('addSectionBtn');
  const savePresetBtn        = document.getElementById('savePresetBtn');
  const cancelEditBtn        = document.getElementById('cancelEditBtn');
  const exportPresetBtn      = document.getElementById('exportPresetBtn');
  const totalDurationDisplay = document.getElementById('totalDurationDisplay');
  const deleteConfirmOverlay = document.getElementById('deleteConfirmOverlay');
  const deleteConfirmText    = document.getElementById('deleteConfirmText');
  const deleteCancelBtn      = document.getElementById('deleteCancelBtn');
  const deleteConfirmBtn     = document.getElementById('deleteConfirmBtn');
  const importArea           = document.getElementById('importArea');
  const importFileInput      = document.getElementById('importFileInput');
  const toastContainer       = document.getElementById('toastContainer');

  // ── Helpers (defined first so available everywhere) ────────────────────────
  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return (
        String(h).padStart(2, '0') + ':' +
        String(min).padStart(2, '0') + ':' +
        String(sec).padStart(2, '0')
      );
    }
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.style.transition = 'opacity 0.4s';
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 400);
    }, duration);
  }

  function getSectionRowData() {
    const rows = sectionRows.querySelectorAll('.section-row');
    return Array.from(rows).map(function (row) {
      const name = row.querySelector('.section-name-input').value.trim();
      const mins = parseInt(row.querySelector('.section-mins-input').value, 10) || 0;
      const secs = parseInt(row.querySelector('.section-secs-input').value, 10) || 0;
      return {
        name: name || 'Untitled Section',
        duration_seconds: (mins * 60) + secs
      };
    });
  }

  function updateTotalDuration() {
    const sections = getSectionRowData();
    const total = sections.reduce(function (acc, s) { return acc + s.duration_seconds; }, 0);
    totalDurationDisplay.textContent = formatTime(total);
  }

  function getTotalSeconds(preset) {
    if (!preset.sections || !preset.sections.length) return 0;
    return preset.sections.reduce(function (a, s) { return a + s.duration_seconds; }, 0);
  }

  // ── Instance config ────────────────────────────────────────────────────────
  fetch('/api/config')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      headerTitle.textContent = cfg.instanceName;
      document.title = 'Presets — ' + cfg.instanceName;
      if (cfg.instanceColor) {
        document.documentElement.style.setProperty('--accent', cfg.instanceColor);
      }
      var base = 'FWC VoG Timing System';
      if (cfg.instanceName !== base) {
        headerInstance.textContent = cfg.instanceName
          .replace(base, '')
          .replace(/^[\s\-\u2013\u2014]+/, '');
      }
    })
    .catch(function () {});

  // ── Load all presets ───────────────────────────────────────────────────────
  function loadPresets() {
    return fetch('/api/presets')
      .then(function (r) { return r.json(); })
      .then(function (presets) {
        allPresets = presets;
        renderSidebar();
      })
      .catch(function () { showToast('Failed to load presets', 'error'); });
  }

  // ── Render sidebar ─────────────────────────────────────────────────────────
  function renderSidebar() {
    if (allPresets.length === 0) {
      presetSidebarList.innerHTML =
        '<li style="padding:1.25rem;color:var(--dazn-text-muted);font-size:0.85rem;text-align:center;">' +
        'No presets yet.<br/>Click <strong>+ New</strong> to create one.</li>';
      return;
    }

    presetSidebarList.innerHTML = '';

    allPresets.forEach(function (preset) {
      var totalSecs = getTotalSeconds(preset);
      var sectionCount = preset.sections ? preset.sections.length : 0;
      var sectionLabel = sectionCount + ' section' + (sectionCount !== 1 ? 's' : '');
      var timeLabel = formatTime(totalSecs);

      var li = document.createElement('li');
      li.className = 'preset-sidebar-item';
      if (preset.id === editingId) li.classList.add('active');
      li.dataset.id = preset.id;

      // Build innerHTML without template literals to avoid any interpolation issues
      var inner = '<div style="flex:1;min-width:0;">';
      inner += '<div class="preset-sidebar-name">' + escapeHtml(preset.name) + '</div>';
      inner += '<div class="preset-sidebar-meta">' + sectionLabel + ' &nbsp;&middot;&nbsp; ' + timeLabel + '</div>';
      inner += '</div>';
      inner += '<div class="preset-sidebar-actions">';
      inner += '<button class="btn-icon" data-action="edit" data-id="' + preset.id + '" title="Edit">\u270F\uFE0F</button>';
      inner += '<button class="btn-icon danger" data-action="delete" data-id="' + preset.id + '" title="Delete">\uD83D\uDDD1</button>';
      inner += '</div>';
      li.innerHTML = inner;

      li.addEventListener('click', function (e) {
        if (e.target.closest('[data-action]')) return;
        openEditor(preset.id);
      });

      li.querySelector('[data-action="edit"]').addEventListener('click', function (e) {
        e.stopPropagation();
        openEditor(preset.id);
      });

      li.querySelector('[data-action="delete"]').addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDelete(preset.id, preset.name);
      });

      presetSidebarList.appendChild(li);
    });
  }

  // ── Open editor ────────────────────────────────────────────────────────────
  function openEditor(presetId) {
    var preset = null;
    for (var i = 0; i < allPresets.length; i++) {
      if (allPresets[i].id === presetId) { preset = allPresets[i]; break; }
    }
    if (!preset) return;

    editingId = presetId;
    editingPresetId.value = presetId;
    editorTitle.textContent = 'Edit Preset';
    presetName.value = preset.name;
    presetDescription.value = preset.description || '';

    renderSectionRows(preset.sections);
    showEditorForm();
    renderSidebar();
  }

  function openNewEditor() {
    editingId = null;
    editingPresetId.value = '';
    editorTitle.textContent = 'New Preset';
    presetName.value = '';
    presetDescription.value = '';

    renderSectionRows([
      { name: '', duration_seconds: 0 },
      { name: '', duration_seconds: 0 },
      { name: '', duration_seconds: 0 }
    ]);

    showEditorForm();
    renderSidebar();
  }

  function showEditorForm() {
    editorEmpty.classList.add('hidden');
    editorForm.classList.remove('hidden');
    updateTotalDuration();
  }

  function hideEditorForm() {
    editorEmpty.classList.remove('hidden');
    editorForm.classList.add('hidden');
    editingId = null;
    renderSidebar();
  }

  // ── Render section rows ────────────────────────────────────────────────────
  function renderSectionRows(sections) {
    sectionRows.innerHTML = '';
    sections.forEach(function (section, index) {
      appendSectionRow(section, index);
    });
    updateTotalDuration();
  }

  function appendSectionRow(section, index) {
    var mins = Math.floor((section.duration_seconds || 0) / 60);
    var secs = (section.duration_seconds || 0) % 60;
    var rowCount = sectionRows.querySelectorAll('.section-row').length;
    var displayIndex = (index !== undefined) ? index : rowCount;

    var row = document.createElement('div');
    row.className = 'section-row';
    row.draggable = true;
    row.dataset.index = displayIndex;

    // Build row HTML without template literals
    var html = '';
    html += '<span class="section-row-handle" title="Drag to reorder">\u2807</span>';
    html += '<input class="form-input section-name-input" type="text" placeholder="Section name" value="' + escapeHtml(section.name || '') + '" maxlength="60" />';
    html += '<input class="form-input section-mins-input" type="number" min="0" max="99" placeholder="00" value="' + mins + '" style="text-align:center;" />';
    html += '<input class="form-input section-secs-input" type="number" min="0" max="59" placeholder="00" value="' + secs + '" style="text-align:center;" />';
    html += '<button class="btn-icon danger remove-section-btn" title="Remove section">\u2715</button>';
    row.innerHTML = html;

    // Remove row
    row.querySelector('.remove-section-btn').addEventListener('click', function () {
      var allRows = sectionRows.querySelectorAll('.section-row');
      if (allRows.length <= 1) {
        showToast('A preset must have at least one section', 'warning');
        return;
      }
      row.remove();
      reindexRows();
      updateTotalDuration();
    });

    // Clamp and update on input
    row.querySelector('.section-mins-input').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 0) e.target.value = 0;
      if (v > 99) e.target.value = 99;
      updateTotalDuration();
    });

    row.querySelector('.section-secs-input').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 0) e.target.value = 0;
      if (v > 59) e.target.value = 59;
      updateTotalDuration();
    });

    row.querySelector('.section-name-input').addEventListener('input', updateTotalDuration);

    // ── Drag and drop ──────────────────────────────────────────────────────
    row.addEventListener('dragstart', function (e) {
      dragSrcIndex = getRowIndex(row);
      row.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', function () {
      row.style.opacity = '1';
      document.querySelectorAll('.section-row').forEach(function (r) {
        r.classList.remove('drag-over');
      });
    });

    row.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', function () {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', function (e) {
      e.preventDefault();
      row.classList.remove('drag-over');
      var targetIndex = getRowIndex(row);
      if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

      var rows = Array.from(sectionRows.querySelectorAll('.section-row'));
      var srcRow = rows[dragSrcIndex];
      var targetRow = rows[targetIndex];

      if (dragSrcIndex < targetIndex) {
        sectionRows.insertBefore(srcRow, targetRow.nextSibling);
      } else {
        sectionRows.insertBefore(srcRow, targetRow);
      }

      reindexRows();
      dragSrcIndex = null;
    });

    sectionRows.appendChild(row);
  }

  function getRowIndex(row) {
    return Array.from(sectionRows.querySelectorAll('.section-row')).indexOf(row);
  }

  function reindexRows() {
    sectionRows.querySelectorAll('.section-row').forEach(function (row, i) {
      row.dataset.index = i;
    });
  }

  // ── Add section ────────────────────────────────────────────────────────────
  addSectionBtn.addEventListener('click', function () {
    appendSectionRow({ name: '', duration_seconds: 0 });
    var rows = sectionRows.querySelectorAll('.section-row');
    var lastRow = rows[rows.length - 1];
    lastRow.querySelector('.section-name-input').focus();
    updateTotalDuration();
  });

  // ── Cancel ─────────────────────────────────────────────────────────────────
  cancelEditBtn.addEventListener('click', function () {
    hideEditorForm();
  });

  // ── New preset ─────────────────────────────────────────────────────────────
  newPresetBtn.addEventListener('click', function () {
    openNewEditor();
  });

  // ── Save preset ────────────────────────────────────────────────────────────
  savePresetBtn.addEventListener('click', savePreset);

  function savePreset() {
    var name = presetName.value.trim();
    if (!name) {
      showToast('Please enter a preset name', 'warning');
      presetName.focus();
      return;
    }

    var sections = getSectionRowData();
    if (sections.length === 0) {
      showToast('Please add at least one section', 'warning');
      return;
    }

    var zeroDuration = sections.filter(function (s) { return s.duration_seconds === 0; });
    if (zeroDuration.length > 0) {
      showToast(zeroDuration.length + ' section(s) have zero duration', 'warning', 5000);
    }

    var payload = {
      name: name,
      description: presetDescription.value.trim(),
      sections: sections.map(function (s, i) {
        return { name: s.name, duration_seconds: s.duration_seconds, order_index: i };
      })
    };

    var currentEditingId = editingPresetId.value;
    var url = currentEditingId ? '/api/presets/' + currentEditingId : '/api/presets';
    var method = currentEditingId ? 'PUT' : 'POST';

    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Save failed'); });
        return r.json();
      })
      .then(function (saved) {
        editingId = saved.id;
        editingPresetId.value = saved.id;
        editorTitle.textContent = 'Edit Preset';
        showToast('Preset "' + saved.name + '" saved', 'success');
        return loadPresets();
      })
      .catch(function (err) {
        showToast('Error: ' + err.message, 'error');
      });
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  exportPresetBtn.addEventListener('click', function () {
    var id = editingPresetId.value;
    if (!id) {
      showToast('Save the preset before exporting', 'warning');
      return;
    }
    window.location.href = '/api/presets/' + id + '/export';
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  function confirmDelete(presetId, presetNameStr) {
    pendingDeleteId = presetId;
    deleteConfirmText.textContent =
      'Are you sure you want to delete "' + presetNameStr + '"? This cannot be undone.';
    deleteConfirmOverlay.classList.add('open');
  }

  deleteCancelBtn.addEventListener('click', function () {
    deleteConfirmOverlay.classList.remove('open');
    pendingDeleteId = null;
  });

  deleteConfirmBtn.addEventListener('click', function () {
    if (!pendingDeleteId) return;
    deleteConfirmOverlay.classList.remove('open');

    fetch('/api/presets/' + pendingDeleteId, { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) throw new Error('Delete failed');
        showToast('Preset deleted', 'success');
        if (editingId === pendingDeleteId) hideEditorForm();
        pendingDeleteId = null;
        return loadPresets();
      })
      .catch(function (err) {
        showToast('Error: ' + err.message, 'error');
        pendingDeleteId = null;
      });
  });

  // ── Import ─────────────────────────────────────────────────────────────────
  importArea.addEventListener('click', function () {
    importFileInput.click();
  });

  importArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    importArea.style.borderColor = 'var(--accent)';
    importArea.style.background = 'rgba(248,255,0,0.05)';
  });

  importArea.addEventListener('dragleave', function () {
    importArea.style.borderColor = '';
    importArea.style.background = '';
  });

  importArea.addEventListener('drop', function (e) {
    e.preventDefault();
    importArea.style.borderColor = '';
    importArea.style.background = '';
    var file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  });

  importFileInput.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (file) handleImportFile(file);
    importFileInput.value = '';
  });

  function handleImportFile(file) {
    if (!file.name.endsWith('.json')) {
      showToast('Please select a valid .json preset file', 'error');
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data.name || !Array.isArray(data.sections)) {
          throw new Error('Invalid preset file format');
        }

        fetch('/api/presets/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })
          .then(function (r) {
            if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Import failed'); });
            return r.json();
          })
          .then(function (imported) {
            showToast('Imported "' + imported.name + '" successfully', 'success');
            return loadPresets().then(function () {
              openEditor(imported.id);
            });
          })
          .catch(function (err) {
            showToast('Import error: ' + err.message, 'error');
          });

      } catch (err) {
        showToast('Import error: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  loadPresets();

})();