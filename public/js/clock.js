(() => {
  const socket = io();

  // ── State ──────────────────────────────────────────────────────────────────
  let currentState = null;
  let selectedPresetId = null;
  let pendingLoadPresetId = null;
  let utcInterval = null;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const utcTimeEl          = document.getElementById('utcTime');
  const utcDateEl          = document.getElementById('utcDate');
  const sectionsContainer  = document.getElementById('sectionsContainer');
  const presetNameDisplay  = document.getElementById('presetNameDisplay');
  const totalRemainingEl   = document.getElementById('totalRemaining');
  const statusBadgeEl      = document.getElementById('statusBadge');
  const currentSectionBlock= document.getElementById('currentSectionBlock');
  const currentSectionTime = document.getElementById('currentSectionTime');
  const currentSectionName = document.getElementById('currentSectionName');
  const headerTitle        = document.getElementById('headerTitle');
  const headerInstance     = document.getElementById('headerInstance');

  const startBtn    = document.getElementById('startBtn');
  const resetBtn    = document.getElementById('resetBtn');
  const pauseBtn    = document.getElementById('pauseBtn');
  const resumeBtn   = document.getElementById('resumeBtn');
  const skipNextBtn = document.getElementById('skipNextBtn');
  const skipPrevBtn = document.getElementById('skipPrevBtn');
  const loadPresetBtn = document.getElementById('loadPresetBtn');

  const loadPresetModal       = document.getElementById('loadPresetModal');
  const closeModalBtn         = document.getElementById('closeModalBtn');
  const cancelModalBtn        = document.getElementById('cancelModalBtn');
  const confirmLoadBtn        = document.getElementById('confirmLoadBtn');
  const presetListModal       = document.getElementById('presetListModal');
  const confirmReplaceOverlay = document.getElementById('confirmReplaceOverlay');
  const confirmReplaceCancel  = document.getElementById('confirmReplaceCancel');
  const confirmReplaceOk      = document.getElementById('confirmReplaceOk');
  const toastContainer        = document.getElementById('toastContainer');

  // ── Instance config ────────────────────────────────────────────────────────
  fetch('/api/config')
    .then(r => r.json())
    .then(cfg => {
      headerTitle.textContent = cfg.instanceName;
      document.title = cfg.instanceName;
      if (cfg.instanceColor) {
        document.documentElement.style.setProperty('--accent', cfg.instanceColor);
      }
      // Show instance sub-label only if it differs from base name
      const base = 'FWC VoG Timing System';
      if (cfg.instanceName !== base) {
        headerInstance.textContent = cfg.instanceName.replace(base, '').replace(/^[\s\-–—]+/, '');
      }
    })
    .catch(() => {});

  // ── UTC Clock ──────────────────────────────────────────────────────────────
  function updateUtcClock() {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    utcTimeEl.textContent = `${hh}:${mm}:${ss}`;

    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    utcDateEl.textContent = `${days[now.getUTCDay()]} ${now.getUTCDate()} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  }

  updateUtcClock();
  utcInterval = setInterval(updateUtcClock, 1000);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatTime(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) return '--:--';
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    }
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.4s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  // ── Render sections list ───────────────────────────────────────────────────
  function renderSections(state) {
    if (!state.sections || state.sections.length === 0) {
      sectionsContainer.innerHTML = `
        <div class="no-preset">
          <div class="no-preset-icon">📋</div>
          <p>No preset loaded.</p>
          <p>Load a preset to begin.</p>
        </div>`;
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'sections-list';

    state.sections.forEach((section, index) => {
      const li = document.createElement('li');
      li.className = 'section-item';

      let stateClass = 'future';
      let statusIcon = '';
      let timeDisplay = '';

      if (index < state.currentSectionIndex) {
        stateClass = 'past';
        statusIcon = '✓';
        timeDisplay = formatTime(0);
      } else if (index === state.currentSectionIndex) {
        if (state.status === 'idle' || state.status === 'finished') {
          stateClass = state.status === 'finished' ? 'past' : 'idle';
          statusIcon = state.status === 'finished' ? '✓' : '';
          timeDisplay = formatTime(section.duration_seconds);
        } else {
          stateClass = 'active';
          statusIcon = state.status === 'paused' ? '⏸' : '▶';
          timeDisplay = formatTime(state.currentSectionRemaining);
        }
      } else {
        stateClass = 'future';
        statusIcon = '';
        timeDisplay = formatTime(section.duration_seconds);
      }

      li.classList.add(stateClass);
      li.innerHTML = `
        <span class="section-index">${index + 1}</span>
        <span class="section-name">${escapeHtml(section.name)}</span>
        <span class="section-duration">${timeDisplay}</span>
        <span class="section-status-icon">${statusIcon}</span>
      `;

      ul.appendChild(li);
    });

    sectionsContainer.innerHTML = '';
    sectionsContainer.appendChild(ul);

    // Auto-scroll active section into view
    const activeItem = sectionsContainer.querySelector('.section-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ── Render controls ────────────────────────────────────────────────────────
  function renderControls(state) {
    const hasPreset = state.sections && state.sections.length > 0;
    const isRunning = state.status === 'running';
    const isPaused  = state.status === 'paused';
    const isIdle    = state.status === 'idle';
    const isFinished= state.status === 'finished';

    // Start button
    startBtn.disabled = !hasPreset || isRunning || isPaused;
    startBtn.textContent = isFinished ? '↺ Restart' : '▶ Start';

    // Reset
    resetBtn.disabled = isIdle && !hasPreset;

    // Pause / Resume
    if (isRunning) {
      pauseBtn.classList.remove('hidden');
      resumeBtn.classList.add('hidden');
    } else if (isPaused) {
      pauseBtn.classList.add('hidden');
      resumeBtn.classList.remove('hidden');
    } else {
      pauseBtn.classList.add('hidden');
      resumeBtn.classList.add('hidden');
    }

    // Override skip buttons
    skipNextBtn.disabled = !hasPreset || isIdle || isFinished;
    skipPrevBtn.disabled = !hasPreset || isIdle || isFinished || state.currentSectionIndex === 0;
  }

  // ── Render totals panel ────────────────────────────────────────────────────
  function renderTotals(state) {
    // Total remaining
    if (state.status === 'idle') {
      totalRemainingEl.textContent = formatTime(state.totalDuration);
    } else if (state.status === 'finished') {
      totalRemainingEl.textContent = '00:00';
    } else {
      totalRemainingEl.textContent = formatTime(state.totalRemaining);
    }

    // Status badge
    statusBadgeEl.className = `status-badge ${state.status}`;
    const labels = { idle: 'Idle', running: 'Running', paused: 'Paused', finished: 'Finished' };
    statusBadgeEl.textContent = labels[state.status] || state.status;

    // Current section detail
    if ((state.status === 'running' || state.status === 'paused') && state.sections.length > 0) {
      currentSectionBlock.style.display = 'block';
      const section = state.sections[state.currentSectionIndex];
      currentSectionTime.textContent = formatTime(state.currentSectionRemaining);
      currentSectionName.textContent = section ? section.name : '--';
    } else {
      currentSectionBlock.style.display = 'none';
    }
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function render(state) {
    currentState = state;

    presetNameDisplay.textContent = state.presetName || 'No preset loaded';

    renderSections(state);
    renderControls(state);
    renderTotals(state);
  }

  // ── Socket events ──────────────────────────────────────────────────────────
  socket.on('connect', () => {
    showToast('Connected to timing server', 'success', 2000);
  });

  socket.on('disconnect', () => {
    showToast('Disconnected from server — attempting to reconnect...', 'error', 5000);
  });

  socket.on('timerTick', (state) => {
    render(state);
  });

  socket.on('timerFinished', (state) => {
    render(state);
    showToast('✅ All sections complete!', 'success', 5000);
  });

  // ── Button handlers ────────────────────────────────────────────────────────
  startBtn.addEventListener('click', () => {
    if (currentState && currentState.status === 'finished') {
      socket.emit('timerReset');
      setTimeout(() => socket.emit('timerStart'), 100);
    } else {
      socket.emit('timerStart');
    }
  });

  resetBtn.addEventListener('click', () => {
    socket.emit('timerReset');
  });

  pauseBtn.addEventListener('click', () => {
    socket.emit('timerPause');
  });

  resumeBtn.addEventListener('click', () => {
    socket.emit('timerResume');
  });

  skipNextBtn.addEventListener('click', () => {
    socket.emit('timerSkipNext');
    showToast('Skipped to next section', 'warning', 2000);
  });

  skipPrevBtn.addEventListener('click', () => {
    socket.emit('timerSkipPrev');
    showToast('Skipped to previous section', 'warning', 2000);
  });

  // ── Load Preset Modal ──────────────────────────────────────────────────────
  loadPresetBtn.addEventListener('click', openLoadModal);
  closeModalBtn.addEventListener('click', closeLoadModal);
  cancelModalBtn.addEventListener('click', closeLoadModal);

  loadPresetModal.addEventListener('click', (e) => {
    if (e.target === loadPresetModal) closeLoadModal();
  });

  function openLoadModal() {
    selectedPresetId = null;
    confirmLoadBtn.disabled = true;
    presetListModal.innerHTML = '<li style="padding:1rem;color:var(--dazn-text-muted);font-size:0.85rem;">Loading...</li>';
    loadPresetModal.classList.add('open');

    fetch('/api/presets')
      .then(r => r.json())
      .then(presets => {
        if (presets.length === 0) {
          presetListModal.innerHTML = '<li style="padding:1rem;color:var(--dazn-text-muted);font-size:0.85rem;">No presets saved yet. <a href="/presets">Create one</a>.</li>';
          return;
        }
        presetListModal.innerHTML = '';
        presets.forEach(preset => {
          const totalSecs = preset.sections.reduce((a, s) => a + s.duration_seconds, 0);
          const li = document.createElement('li');
          li.className = 'preset-list-item';
          li.dataset.id = preset.id;
          li.innerHTML = `
            <div class="preset-item-name">${escapeHtml(preset.name)}</div>
            <div class="preset-item-meta">
              ${preset.sections.length} section${preset.sections.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
              Total: ${formatTime(totalSecs)}
              ${preset.description ? `&nbsp;·&nbsp; ${escapeHtml(preset.description)}` : ''}
            </div>
          `;
          li.addEventListener('click', () => {
            document.querySelectorAll('.preset-list-item').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');
            selectedPresetId = preset.id;
            confirmLoadBtn.disabled = false;
          });
          // Double-click to load immediately
          li.addEventListener('dblclick', () => {
            selectedPresetId = preset.id;
            confirmLoadBtn.disabled = false;
            handleLoadConfirm();
          });
          presetListModal.appendChild(li);
        });
      })
      .catch(() => {
        presetListModal.innerHTML = '<li style="padding:1rem;color:var(--dazn-danger);font-size:0.85rem;">Failed to load presets.</li>';
      });
  }

  function closeLoadModal() {
    loadPresetModal.classList.remove('open');
    selectedPresetId = null;
  }

  confirmLoadBtn.addEventListener('click', handleLoadConfirm);

  function handleLoadConfirm() {
    if (!selectedPresetId) return;

    const isActive = currentState &&
      (currentState.status === 'running' || currentState.status === 'paused');

    if (isActive) {
      pendingLoadPresetId = selectedPresetId;
      closeLoadModal();
      confirmReplaceOverlay.classList.add('open');
    } else {
      doLoadPreset(selectedPresetId);
      closeLoadModal();
    }
  }

  confirmReplaceCancel.addEventListener('click', () => {
    confirmReplaceOverlay.classList.remove('open');
    pendingLoadPresetId = null;
  });

  confirmReplaceOk.addEventListener('click', () => {
    confirmReplaceOverlay.classList.remove('open');
    if (pendingLoadPresetId) {
      doLoadPreset(pendingLoadPresetId);
      pendingLoadPresetId = null;
    }
  });

  function doLoadPreset(presetId) {
    socket.emit('loadPreset', { presetId });
    showToast('Preset loaded', 'success', 2500);
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();