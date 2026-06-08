const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');
const apiRouter = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = 3000;
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'FWC VoG Timing System';
const INSTANCE_COLOR = process.env.INSTANCE_COLOR || '#F8FF00';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.locals.instanceName = INSTANCE_NAME;
  res.locals.instanceColor = INSTANCE_COLOR;
  next();
});

// ── Timer IDs ─────────────────────────────────────────────────────────────────
const TIMER_IDS = ['primary', 'secondary-1', 'secondary-2', 'secondary-3'];

// ── Timer Factory ─────────────────────────────────────────────────────────────
function makeTimerState() {
  return {
    status: 'idle',
    presetId: null,
    presetName: null,
    sections: [],
    currentSectionIndex: 0,
    sectionStartTime: null,
    pausedTimeRemaining: null,
    totalDuration: 0,
    totalElapsed: 0
  };
}

const timers = {};
const tickIntervals = {};

TIMER_IDS.forEach(id => {
  timers[id] = makeTimerState();
  tickIntervals[id] = null;
});

// ── Serialise state ───────────────────────────────────────────────────────────
function getSerializableState(timerId) {
  const state = { ...timers[timerId], timerId };

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

// ── Tick helpers ──────────────────────────────────────────────────────────────
function startTick(timerId) {
  if (tickIntervals[timerId]) return;
  tickIntervals[timerId] = setInterval(() => {
    const t = timers[timerId];
    if (t.status !== 'running') return;
    const section = t.sections[t.currentSectionIndex];
    if (!section) return;
    const elapsed = Date.now() - t.sectionStartTime;
    const remaining = (section.duration_seconds * 1000) - elapsed;
    if (remaining <= 0) {
      advanceSection(timerId);
    } else {
      io.emit('timerTick', getSerializableState(timerId));
    }
  }, 250);
}

function stopTick(timerId) {
  if (tickIntervals[timerId]) {
    clearInterval(tickIntervals[timerId]);
    tickIntervals[timerId] = null;
  }
}

function advanceSection(timerId, manual = false) {
  const t = timers[timerId];
  const nextIndex = t.currentSectionIndex + 1;

  t.totalElapsed += t.sections[t.currentSectionIndex].duration_seconds;

  if (nextIndex >= t.sections.length) {
    t.status = 'finished';
    t.currentSectionIndex = t.sections.length - 1;
    t.totalElapsed = t.totalDuration;
    stopTick(timerId);
    io.emit('timerFinished', getSerializableState(timerId));
    return;
  }

  t.currentSectionIndex = nextIndex;
  t.sectionStartTime = Date.now();
  t.pausedTimeRemaining = null;
  io.emit('timerTick', getSerializableState(timerId));
}

function goBackSection(timerId) {
  const t = timers[timerId];
  if (t.currentSectionIndex <= 0) return;
  t.totalElapsed -= t.sections[t.currentSectionIndex - 1].duration_seconds;
  if (t.totalElapsed < 0) t.totalElapsed = 0;
  t.currentSectionIndex -= 1;
  t.sectionStartTime = Date.now();
  t.pausedTimeRemaining = null;
  io.emit('timerTick', getSerializableState(timerId));
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send all timer states on connect
  TIMER_IDS.forEach(id => socket.emit('timerTick', getSerializableState(id)));

  socket.on('timerStart', ({ timerId }) => {
    if (!timers[timerId]) return;
    const t = timers[timerId];
    if ((t.status === 'idle' || t.status === 'finished') && t.sections.length > 0) {
      t.status = 'running';
      t.currentSectionIndex = 0;
      t.sectionStartTime = Date.now();
      t.totalElapsed = 0;
      t.pausedTimeRemaining = null;
      startTick(timerId);
      io.emit('timerTick', getSerializableState(timerId));
    }
  });

  socket.on('timerPause', ({ timerId }) => {
    if (!timers[timerId]) return;
    const t = timers[timerId];
    if (t.status === 'running') {
      const section = t.sections[t.currentSectionIndex];
      const elapsed = Date.now() - t.sectionStartTime;
      t.pausedTimeRemaining = Math.max(0, (section.duration_seconds * 1000) - elapsed);
      t.status = 'paused';
      io.emit('timerTick', getSerializableState(timerId));
    }
  });

  socket.on('timerResume', ({ timerId }) => {
    if (!timers[timerId]) return;
    const t = timers[timerId];
    if (t.status === 'paused') {
      t.sectionStartTime = Date.now() -
        ((t.sections[t.currentSectionIndex].duration_seconds * 1000) - t.pausedTimeRemaining);
      t.status = 'running';
      t.pausedTimeRemaining = null;
      startTick(timerId);
      io.emit('timerTick', getSerializableState(timerId));
    }
  });

  socket.on('timerReset', ({ timerId }) => {
    if (!timers[timerId]) return;
    const t = timers[timerId];
    t.status = 'idle';
    t.currentSectionIndex = 0;
    t.sectionStartTime = null;
    t.pausedTimeRemaining = null;
    t.totalElapsed = 0;
    stopTick(timerId);
    io.emit('timerTick', getSerializableState(timerId));
  });

  socket.on('timerSkipNext', ({ timerId }) => {
    if (!timers[timerId]) return;
    const t = timers[timerId];
    if (t.status === 'running' || t.status === 'paused') {
      if (t.status === 'paused') t.status = 'running';
      advanceSection(timerId, true);
    }
  });

  socket.on('timerSkipPrev', ({ timerId }) => {
    if (!timers[timerId]) return;
    const t = timers[timerId];
    if (t.status === 'running' || t.status === 'paused') {
      goBackSection(timerId);
    }
  });

  socket.on('loadPreset', ({ timerId, presetId }) => {
    if (!timers[timerId]) return;
    const preset = db.getPresetById(presetId);
    if (!preset) return;
    const t = timers[timerId];
    t.status = 'idle';
    t.presetId = preset.id;
    t.presetName = preset.name;
    t.sections = preset.sections;
    t.currentSectionIndex = 0;
    t.sectionStartTime = null;
    t.pausedTimeRemaining = null;
    t.totalElapsed = 0;
    t.totalDuration = preset.sections.reduce((acc, s) => acc + s.duration_seconds, 0);
    stopTick(timerId);
    io.emit('timerTick', getSerializableState(timerId));
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'clock.html')));
app.get('/presets', (req, res) => res.sendFile(path.join(__dirname, 'public', 'presets.html')));

app.get('/api/config', (req, res) => {
  res.json({ instanceName: INSTANCE_NAME, instanceColor: INSTANCE_COLOR });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FWC VoG Timing System running on port ${PORT}`);
  console.log(`Instance: ${INSTANCE_NAME}`);
});