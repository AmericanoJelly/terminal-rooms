const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PARTICIPANTS = 10;
const MAX_MESSAGES = 100;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map();

function sanitizeText(value, max = 100) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function isExpired(room) {
  return !room || room.expiresAt <= Date.now();
}

function activeParticipantCount(room) {
  let count = 0;
  for (const participant of room.participants.values()) {
    if (participant.isOnline) count += 1;
  }
  return count;
}

function roomSummary(room, clientId = '') {
  const participant = clientId ? room.participants.get(clientId) : null;
  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    isExpired: isExpired(room),
    activeParticipantCount: activeParticipantCount(room),
    totalParticipantCount: room.participants.size,
    maxParticipants: MAX_PARTICIPANTS,
    isJoined: Boolean(participant),
    nickname: participant?.nickname || null,
    shareUrl: `/room/${room.id}`,
  };
}

function emitRoomUpdate(room) {
  io.to(room.id).emit('room:update', roomSummary(room));
}

function addSystemMessage(room, content) {
  const msg = {
    id: uuidv4(),
    type: 'system',
    senderNickname: 'system',
    content,
    createdAt: Date.now(),
  };
  room.messages.push(msg);
  room.messages = room.messages.slice(-MAX_MESSAGES);
  io.to(room.id).emit('message:new', msg);
  emitRoomUpdate(room);
}

function deleteRoom(roomId, reason = 'deleted') {
  io.to(roomId).emit('room:deleted', { roomId, reason });
  rooms.delete(roomId);
}

function cleanupRoomIfEmpty(room) {
  if (!room) return false;
  if (activeParticipantCount(room) === 0) {
    deleteRoom(room.id, 'empty');
    return true;
  }
  return false;
}

function createRoom(name, clientId, nickname = 'host') {
  const id = uuidv4().slice(0, 8);
  const now = Date.now();
  const room = {
    id,
    name: sanitizeText(name, 30),
    createdAt: now,
    expiresAt: now + ROOM_TTL_MS,
    participants: new Map(),
    messages: [],
  };
  room.participants.set(clientId, { nickname: sanitizeText(nickname, 20), isOnline: true, lastSeen: now });
  room.messages.push({
    id: uuidv4(),
    type: 'system',
    senderNickname: 'system',
    content: `${sanitizeText(nickname, 20)} created the room`,
    createdAt: now,
  });
  rooms.set(id, room);
  return room;
}

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.expiresAt <= now) {
      io.to(roomId).emit('room:expired', { roomId });
      rooms.delete(roomId);
    }
  }
}, 30000);

app.get('/api/session/init', (req, res) => {
  const clientId = sanitizeText(req.query.clientId || uuidv4(), 64);
  res.json({ clientId });
});

app.post('/api/rooms', (req, res) => {
  const name = sanitizeText(req.body.name, 30);
  const clientId = sanitizeText(req.body.clientId, 64);
  const nickname = sanitizeText(req.body.nickname || 'host', 20);
  if (!name) return res.status(400).json({ error: 'room name required' });
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const room = createRoom(name, clientId, nickname);
  res.json({ room: roomSummary(room, clientId) });
});

app.get('/api/rooms', (req, res) => {
  const clientId = sanitizeText(req.query.clientId, 64);
  if (!clientId) return res.json({ rooms: [] });
  const result = [];
  for (const room of rooms.values()) {
    if (!isExpired(room) && room.participants.has(clientId)) {
      result.push(roomSummary(room, clientId));
    }
  }
  result.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ rooms: result });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  const clientId = sanitizeText(req.query.clientId || '', 64);
  if (!room || isExpired(room)) return res.status(404).json({ error: 'room not found or expired' });
  res.json({ room: roomSummary(room, clientId) });
});

app.get('/api/rooms/:roomId/messages', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room || isExpired(room)) return res.status(404).json({ error: 'room not found or expired' });
  res.json({ messages: room.messages.slice(-MAX_MESSAGES) });
});

app.post('/api/rooms/:roomId/join', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room || isExpired(room)) return res.status(404).json({ error: 'room not found or expired' });

  const clientId = sanitizeText(req.body.clientId, 64);
  const nickname = sanitizeText(req.body.nickname, 20);
  if (!clientId || !nickname) return res.status(400).json({ error: 'clientId and nickname required' });

  const existing = room.participants.get(clientId);
  if (!existing && activeParticipantCount(room) >= MAX_PARTICIPANTS) {
    return res.status(409).json({ error: 'room is full' });
  }

  if (existing) {
    existing.nickname = nickname;
    existing.isOnline = true;
    existing.lastSeen = Date.now();
    emitRoomUpdate(room);
  } else {
    room.participants.set(clientId, { nickname, isOnline: true, lastSeen: Date.now() });
    addSystemMessage(room, `${nickname} joined`);
  }

  res.json({ room: roomSummary(room, clientId), participant: { clientId, nickname } });
});

app.post('/api/rooms/:roomId/leave', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room || isExpired(room)) return res.json({ ok: true });

  const clientId = sanitizeText(req.body.clientId, 64);
  const participant = room.participants.get(clientId);
  if (participant && participant.isOnline) {
    participant.isOnline = false;
    participant.lastSeen = Date.now();
    addSystemMessage(room, `${participant.nickname} left`);
    cleanupRoomIfEmpty(room);
  }

  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, clientId }) => {
    const room = rooms.get(roomId);
    if (!room || isExpired(room)) {
      socket.emit('room:expired', { roomId });
      return;
    }
    const participant = room.participants.get(clientId);
    if (!participant || !participant.isOnline) {
      socket.emit('room:error', { message: 'join room via HTTP first' });
      return;
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.clientId = clientId;
    socket.emit('room:update', roomSummary(room, clientId));
  });

  socket.on('message:send', ({ roomId, clientId, content }) => {
    const room = rooms.get(roomId);
    if (!room || isExpired(room)) {
      socket.emit('room:expired', { roomId });
      return;
    }
    const participant = room.participants.get(clientId);
    if (!participant || !participant.isOnline) {
      socket.emit('room:error', { message: 'not active in room' });
      return;
    }
    const safeContent = sanitizeText(content, 500);
    if (!safeContent) return;
    const msg = {
      id: uuidv4(),
      type: 'message',
      senderNickname: participant.nickname,
      content: safeContent,
      createdAt: Date.now(),
    };
    room.messages.push(msg);
    room.messages = room.messages.slice(-MAX_MESSAGES);
    io.to(roomId).emit('message:new', msg);
  });

  socket.on('room:leave', ({ roomId, clientId }) => {
    const room = rooms.get(roomId);
    if (!room || isExpired(room)) return;
    const participant = room.participants.get(clientId);
    if (participant && participant.isOnline) {
      participant.isOnline = false;
      participant.lastSeen = Date.now();
      addSystemMessage(room, `${participant.nickname} left`);
      if (cleanupRoomIfEmpty(room)) return;
    }
    socket.leave(roomId);
  });
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Terminal Rooms running on http://localhost:${PORT}`);
});
