const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');
const apiRouter = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = 3000;
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'FWC VoG Timing System';
const INSTANCE_COLOR = process.env.INSTANCE_COLOR || '#F8FF00';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Make instance config available to templates via res.locals
app.use((req, res, next) => {
  res.locals.instanceName = INSTANCE_NAME;
  res.locals.instanceColor = INSTANCE_COLOR;
  next();
});

// ── Timer State (server-side, authoritative) ──────────────────────────────────
const timerState = {
  status: 'idle',          // idle | running | paused | finished
  presetId: null,
  presetName: null,
  sections: [],            // full section list with durations
  currentSectionIndex: 0,
  sectionStartTime: null,  // epoch ms when current section started
  pausedTimeRemaining: null, // ms remaining when paused
  totalDuration: 0,        // total seconds across all sections
  totalElapsed: 0          // seconds elapsed across completed sections
};

function getSerializableState() {
  const state = { ...timerState };

  // Calculate live time remaining for current section
  if (state.status === 'running' && state.sections.length > 0) {
    const section = state.sections[state.currentSectionIndex];
    const elapsed = Date.now() - state.sectionStartTime;
    const remaining = Math.max(0, (section.duration_seconds * 1000) - elapsed);
    state.currentSectionRemaining = Math.ceil(remaining / 1000);
    state.totalRemaining = state.sections
      .slice(state.currentSectionIndex + 1)
      .reduce((acc, s) => acc + s.duration_seconds, 0) + state.currentSectionRemaining;
  } else if (state.status === 'paused') {
    state.currentSectionRemaining = Math.ceil(state.pausedTimeRemaining / 1000);
    state.totalRemaining = state.sections
      .slice(state.currentSectionIndex + 1)
      .reduce((acc, s) => acc + s.duration_seconds, 0) + state.currentSectionRemaining;
  } else {
    state.currentSectionRemaining = state.sections[state.currentSectionIndex]?.duration_seconds || 0;
    state.totalRemaining = state.totalDuration;
  }

  return state;
}

// ── Timer Tick ────────────────────────────────────────────────────────────────
let tickInterval = null;

function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    if (timerState.status !== 'running') return;

    const section = timerState.sections[timerState.currentSectionIndex];
    if (!section) return;

    const elapsed = Date.now() - timerState.sectionStartTime;
    const remaining = (section.duration_seconds * 1000) - elapsed;

    if (remaining <= 0) {
      advanceSection();
    } else {
      io.emit('timerTick', getSerializableState());
    }
  }, 250);
}

function stopTick() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function advanceSection(manual = false) {
  const nextIndex = timerState.currentSectionIndex + 1;

  if (nextIndex >= timerState.sections.length) {
    // All sections complete
    timerState.status = 'finished';
    timerState.currentSectionIndex = timerState.sections.length - 1;
    timerState.totalElapsed = timerState.totalDuration;
    stopTick();
    io.emit('timerFinished', getSerializableState());
    return;
  }

  // Accumulate elapsed for completed sections
  if (!manual) {
    timerState.totalElapsed += timerState.sections[timerState.currentSectionIndex].duration_seconds;
  } else {
    // On manual skip, count the section as fully elapsed
    timerState.totalElapsed += timerState.sections[timerState.currentSectionIndex].duration_seconds;
  }

  timerState.currentSectionIndex = nextIndex;
  timerState.sectionStartTime = Date.now();
  timerState.pausedTimeRemaining = null;

  io.emit('timerTick', getSerializableState());
}

function goBackSection() {
  if (timerState.currentSectionIndex <= 0) return;

  timerState.totalElapsed -= timerState.sections[timerState.currentSectionIndex - 1].duration_seconds;
  if (timerState.totalElapsed < 0) timerState.totalElapsed = 0;

  timerState.currentSectionIndex -= 1;
  timerState.sectionStartTime = Date.now();
  timerState.pausedTimeRemaining = null;

  io.emit('timerTick', getSerializableState());
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send current state immediately on connect
  socket.emit('timerTick', getSerializableState());

  socket.on('timerStart', () => {
    if (timerState.status === 'idle' || timerState.status === 'finished') {
      if (timerState.sections.length === 0) return;
      timerState.status = 'running';
      timerState.currentSectionIndex = 0;
      timerState.sectionStartTime = Date.now();
      timerState.totalElapsed = 0;
      timerState.pausedTimeRemaining = null;
      startTick();
      io.emit('timerTick', getSerializableState());
    }
  });

  socket.on('timerPause', () => {
    if (timerState.status === 'running') {
      const section = timerState.sections[timerState.currentSectionIndex];
      const elapsed = Date.now() - timerState.sectionStartTime;
      timerState.pausedTimeRemaining = Math.max(0, (section.duration_seconds * 1000) - elapsed);
      timerState.status = 'paused';
      io.emit('timerTick', getSerializableState());
    }
  });

  socket.on('timerResume', () => {
    if (timerState.status === 'paused') {
      timerState.sectionStartTime = Date.now() - (
        (timerState.sections[timerState.currentSectionIndex].duration_seconds * 1000) - timerState.pausedTimeRemaining
      );
      timerState.status = 'running';
      timerState.pausedTimeRemaining = null;
      startTick();
      io.emit('timerTick', getSerializableState());
    }
  });

  socket.on('timerReset', () => {
    timerState.status = 'idle';
    timerState.currentSectionIndex = 0;
    timerState.sectionStartTime = null;
    timerState.pausedTimeRemaining = null;
    timerState.totalElapsed = 0;
    stopTick();
    io.emit('timerTick', getSerializableState());
  });

  socket.on('timerSkipNext', () => {
    if (timerState.status === 'running' || timerState.status === 'paused') {
      if (timerState.status === 'paused') timerState.status = 'running';
      advanceSection(true);
    }
  });

  socket.on('timerSkipPrev', () => {
    if (timerState.status === 'running' || timerState.status === 'paused') {
      goBackSection();
    }
  });

  socket.on('loadPreset', ({ presetId }) => {
    const preset = db.getPresetById(presetId);
    if (!preset) return;

    timerState.status = 'idle';
    timerState.presetId = preset.id;
    timerState.presetName = preset.name;
    timerState.sections = preset.sections;
    timerState.currentSectionIndex = 0;
    timerState.sectionStartTime = null;
    timerState.pausedTimeRemaining = null;
    timerState.totalElapsed = 0;
    timerState.totalDuration = preset.sections.reduce((acc, s) => acc + s.duration_seconds, 0);
    stopTick();

    io.emit('timerTick', getSerializableState());
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'clock.html'));
});

app.get('/presets', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'presets.html'));
});

// Pass instance config to frontend via a config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    instanceName: INSTANCE_NAME,
    instanceColor: INSTANCE_COLOR
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`FWC VoG Timing System running on port ${PORT}`);
  console.log(`Instance: ${INSTANCE_NAME}`);
});