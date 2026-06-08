(() => {
  const socket = io();

  // ── Constants ──────────────────────────────────────────────────────────────
  const TIMER_IDS = ['primary', 'secondary-1', 'secondary-2', 'secondary-3'];
  const TIMER_LABELS = {
    'primary':     'Primary',
    'secondary-1': 'Timer 2',
    'secondary-2': 'Timer 3',
    'secondary-3': 'Timer 4'
  };

  // ── State ──────────────────────────────────────────────────────────────────
  const timerStates = {};
  TIMER_IDS.forEach(id => { timerStates[id] = null; });

  let modalTargetTimerId  = null;
  let selectedPresetId    = null;
  let pendingLoadTimerId  = null;
  let pendingLoadPresetId = null;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const utcTimeEl             = document.getElementById('utcTime');
  const utcDateEl             = document.getElementById('utcDate');
  const dallasTimeEl          = document.getElementById('dallasTime');
  const dallasDateEl          = document.getElementById('dallasDate');
  const dallasLabelEl         = document.getElementById('dallasLabel');
  const headerTitle           = document.getElementById('headerTitle');
  const headerInstance        = document.getElementById('headerInstance');
  const loadPresetModal       = document.getElementById('loadPresetModal');
  const modalTimerLabel       = document.getElementById('modalTimerLabel');
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
      const base = 'FWC VoG Timing System';
      if (cfg.instanceName !== base) {
        headerInstance.textContent = cfg.instanceName.replace(base, '').replace(/^[\s\-–—]+/, '');
      }
    })
    .catch(() => {});

  // ── Clocks (UTC + Dallas CT) ───────────────────────────────────────────────
  function updateClocks() {
    const now = new Date();

    // UTC
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    utcTimeEl.textContent = `${hh}:${mm}:${ss}`;
    const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    utcDateEl.textContent = `${days[now.getUTCDay()]} ${now.getUTCDate()} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

    // Dallas — America/Chicago (auto CDT/CST)
    try {
      const p = {};
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      }).formatToParts(now).forEach(({ type, value }) => { p[type] = value; });

      dallasTimeEl.textContent = `${p.hour}:${p.minute}:${p.second}`;
      dallasDateEl.textContent = `${p.weekday} ${p.day} ${p.month} ${p.year}`;

      const tzAbbr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        timeZoneName: 'short'
      }).formatToParts(now).find(x => x.type === 'timeZoneName')?.value || 'CT';
      if (dallasLabelEl) dallasLabelEl.textContent = `Dallas · ${tzAbbr}`;
    } catch (e) {
      if (dallasTimeEl) dallasTimeEl.textContent = '--:--:--';
    }
  }

  updateClocks();
  setInterval(updateClocks, 1000);

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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  // ── Per-timer render ───────────────────────────────────────────────────────
  function renderTimer(state) {
    const id = state.timerId;
    timerStates[id] = state;

    const hasPreset  = state.sections && state.sections.length > 0;
    const isRunning  = state.status === 'running';
    const isPaused   = state.status === 'paused';
    const isIdle     = state.status === 'idle';
    const isFinished = state.status === 'finished';

    // Preset name
    const nameEl = document.getElementById(`presetName-${id}`);
    if (nameEl) nameEl.textContent = state.presetName || 'No preset loaded';

    // Total remaining — now the SECONDARY smaller number
    const totalEl = document.getElementById(`totalRemaining-${id}`);
    if (totalEl) {
      if (isIdle)          totalEl.textContent = formatTime(state.totalDuration);
      else if (isFinished) totalEl.textContent = '00:00';
      else                 totalEl.textContent = formatTime(state.totalRemaining);
    }

    // Status badge
    const badgeEl = document.getElementById(`statusBadge-${id}`);
    if (badgeEl) {
      badgeEl.className = `status-badge ${state.status}`;
      const labels = { idle: 'Idle', running: 'Running', paused: 'Paused', finished: 'Finished' };
      badgeEl.textContent = labels[state.status] || state.status;
    }

    // Current section block — now the PRIMARY large number
    // Always visible when a preset is loaded; shows first section preview when idle
    const csBlock = document.getElementById(`currentSectionBlock-${id}`);
    const csTime  = document.getElementById(`currentSectionTime-${id}`);
    const csName  = document.getElementById(`currentSectionName-${id}`);
    if (csBlock) {
      if (hasPreset) {
        csBlock.style.display = 'block';
        if (isRunning || isPaused) {
          const section = state.sections[state.currentSectionIndex];
          if (csTime) csTime.textContent = formatTime(state.currentSectionRemaining);
          if (csName) csName.textContent = section ? section.name : '--';
        } else if (isFinished) {
          if (csTime) csTime.textContent = '00:00';
          if (csName) csName.textContent = state.sections[state.sections.length - 1]?.name || '--';
        } else {
          // idle — preview first section
          if (csTime) csTime.textContent = formatTime(state.sections[0]?.duration_seconds);
          if (csName) csName.textContent = state.sections[0]?.name || '--';
        }
      } else {
        csBlock.style.display = 'none';
      }
    }

    // Sections list
    const container = document.getElementById(`sections-${id}`);
    if (container) renderSections(state, container);

    // Controls
    const panel = document.querySelector(`[data-timer-id="${id}"]`);
    if (!panel) return;

    const btn = (action) => panel.querySelector(`[data-action="${action}"][data-timer="${id}"]`);

    const startBtn    = btn('start');
    const resetBtn    = btn('reset');
    const pauseBtn    = btn('pause');
    const resumeBtn   = btn('resume');
    const skipNextBtn = btn('skipNext');
    const skipPrevBtn = btn('skipPrev');

    if (startBtn) {
      startBtn.disabled = !hasPreset || isRunning || isPaused;
      startBtn.textContent = isFinished ? '↺ Restart' : '▶ Start';
    }
    if (resetBtn) {
      resetBtn.disabled = isIdle && !hasPreset;
    }
    if (pauseBtn)    pauseBtn.classList.toggle('hidden', !isRunning);
    if (resumeBtn)   resumeBtn.classList.toggle('hidden', !isPaused);
    if (skipNextBtn) skipNextBtn.disabled = !hasPreset || isIdle || isFinished;
    if (skipPrevBtn) skipPrevBtn.disabled = !hasPreset || isIdle || isFinished || state.currentSectionIndex === 0;
  }

  // ── Render sections list ───────────────────────────────────────────────────
  function renderSections(state, container) {
    if (!state.sections || state.sections.length === 0) {
      container.innerHTML = `
        <div class="no-preset">
          <div class="no-preset-icon">📋</div>
          <p>No preset loaded.</p>
        </div>`;
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'sections-list';

    state.sections.forEach((section, index) => {
      const li = document.createElement('li');
      li.className = 'section-item';

      let stateClass, statusIcon, timeDisplay;

      if (index < state.currentSectionIndex) {
        stateClass  = 'past';
        statusIcon  = '✓';
        timeDisplay = formatTime(0);
      } else if (index === state.currentSectionIndex) {
        if (state.status === 'idle' || state.status === 'finished') {
          stateClass  = state.status === 'finished' ? 'past' : 'idle';
          statusIcon  = state.status === 'finished' ? '✓' : '';
          timeDisplay = formatTime(section.duration_seconds);
        } else {
          stateClass  = 'active';
          statusIcon  = state.status === 'paused' ? '⏸' : '▶';
          timeDisplay = formatTime(state.currentSectionRemaining);
        }
      } else {
        stateClass  = 'future';
        statusIcon  = '';
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

    container.innerHTML = '';
    container.appendChild(ul);

    const activeItem = container.querySelector('.section-item.active');
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── Socket events ──────────────────────────────────────────────────────────
  socket.on('connect', () => {
    showToast('Connected to timing server', 'success', 2000);
  });

  socket.on('disconnect', () => {
    showToast('Disconnected from server — attempting to reconnect...', 'error', 5000);
  });

  socket.on('timerTick', (state) => {
    renderTimer(state);
  });

  socket.on('timerFinished', (state) => {
    renderTimer(state);
    showToast(`✅ ${TIMER_LABELS[state.timerId] || state.timerId}: All sections complete!`, 'success', 5000);
  });

  // ── Button event delegation ────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    // Load preset buttons
    const loadBtn = e.target.closest('[data-load-for]');
    if (loadBtn) {
      openLoadModal(loadBtn.dataset.loadFor);
      return;
    }

    // Timer control buttons
    const actionBtn = e.target.closest('[data-action][data-timer]');
    if (!actionBtn) return;

    const action  = actionBtn.dataset.action;
    const timerId = actionBtn.dataset.timer;
    const state   = timerStates[timerId];

    switch (action) {
      case 'start':
        if (state && state.status === 'finished') {
          socket.emit('timerReset', { timerId });
          setTimeout(() => socket.emit('timerStart', { timerId }), 100);
        } else {
          socket.emit('timerStart', { timerId });
        }
        break;
      case 'reset':
        socket.emit('timerReset', { timerId });
        break;
      case 'pause':
        socket.emit('timerPause', { timerId });
        break;
      case 'resume':
        socket.emit('timerResume', { timerId });
        break;
      case 'skipNext':
        socket.emit('timerSkipNext', { timerId });
        showToast(`${TIMER_LABELS[timerId]}: Skipped to next section`, 'warning', 2000);
        break;
      case 'skipPrev':
        socket.emit('timerSkipPrev', { timerId });
        showToast(`${TIMER_LABELS[timerId]}: Skipped to previous section`, 'warning', 2000);
        break;
    }
  });

  // ── Load Preset Modal ──────────────────────────────────────────────────────
  closeModalBtn.addEventListener('click', closeLoadModal);
  cancelModalBtn.addEventListener('click', closeLoadModal);
  loadPresetModal.addEventListener('click', (e) => {
    if (e.target === loadPresetModal) closeLoadModal();
  });

  function openLoadModal(timerId) {
    modalTargetTimerId      = timerId;
    selectedPresetId        = null;
    confirmLoadBtn.disabled = true;
    modalTimerLabel.textContent = TIMER_LABELS[timerId] || timerId;
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
            selectedPresetId        = preset.id;
            confirmLoadBtn.disabled = false;
          });
          li.addEventListener('dblclick', () => {
            selectedPresetId        = preset.id;
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
    selectedPresetId   = null;
    modalTargetTimerId = null;
  }

  confirmLoadBtn.addEventListener('click', handleLoadConfirm);

  function handleLoadConfirm() {
    if (!selectedPresetId || !modalTargetTimerId) return;
    const state    = timerStates[modalTargetTimerId];
    const isActive = state && (state.status === 'running' || state.status === 'paused');

    if (isActive) {
      pendingLoadTimerId  = modalTargetTimerId;
      pendingLoadPresetId = selectedPresetId;
      closeLoadModal();
      confirmReplaceOverlay.classList.add('open');
    } else {
      doLoadPreset(modalTargetTimerId, selectedPresetId);
      closeLoadModal();
    }
  }

  confirmReplaceCancel.addEventListener('click', () => {
    confirmReplaceOverlay.classList.remove('open');
    pendingLoadTimerId  = null;
    pendingLoadPresetId = null;
  });

  confirmReplaceOk.addEventListener('click', () => {
    confirmReplaceOverlay.classList.remove('open');
    if (pendingLoadTimerId && pendingLoadPresetId) {
      doLoadPreset(pendingLoadTimerId, pendingLoadPresetId);
      pendingLoadTimerId  = null;
      pendingLoadPresetId = null;
    }
  });

  function doLoadPreset(timerId, presetId) {
    socket.emit('loadPreset', { timerId, presetId });
    showToast(`${TIMER_LABELS[timerId]}: Preset loaded`, 'success', 2500);
  }

})();