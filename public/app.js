const state = { clientId: null, currentRoom: null, socket: null };
const el = {
  createName: document.getElementById('createName'),
  createNickname: document.getElementById('createNickname'),
  createBtn: document.getElementById('createBtn'),
  createStatus: document.getElementById('createStatus'),
  roomList: document.getElementById('roomList'),
  welcomeView: document.getElementById('welcomeView'),
  joinView: document.getElementById('joinView'),
  chatView: document.getElementById('chatView'),
  joinRoomName: document.getElementById('joinRoomName'),
  joinNickname: document.getElementById('joinNickname'),
  joinBtn: document.getElementById('joinBtn'),
  joinStatus: document.getElementById('joinStatus'),
  chatRoomName: document.getElementById('chatRoomName'),
  chatMeta: document.getElementById('chatMeta'),
  messages: document.getElementById('messages'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput'),
  chatStatus: document.getElementById('chatStatus'),
  copyBtn: document.getElementById('copyBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
};
function setView(name) { ['welcomeView','joinView','chatView'].forEach(k => el[k].classList.toggle('active', k === name)); }
function roomPath(roomId) { return `${window.location.origin}/room/${roomId}`; }
function fmtRemaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m left`;
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}
async function initSession() {
  const stored = localStorage.getItem('terminal_rooms_client_id');
  const { clientId } = await api(`/api/session/init${stored ? `?clientId=${encodeURIComponent(stored)}` : ''}`);
  state.clientId = clientId;
  localStorage.setItem('terminal_rooms_client_id', clientId);
}
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function renderRooms(rooms) {
  el.roomList.innerHTML = '';
  if (!rooms.length) {
    el.roomList.innerHTML = '<div class="muted">no joined rooms</div>';
    return;
  }
  rooms.forEach(room => {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `
      <h3>${escapeHtml(room.name)}</h3>
      <div class="meta">${room.activeParticipantCount}/${room.maxParticipants} active · ${fmtRemaining(room.expiresAt)}</div>
      <div class="row">
        <button data-open="${room.id}">open</button>
        <button data-copy="${room.id}">copy</button>
      </div>`;
    card.querySelector('[data-open]').onclick = () => openRoom(room.id);
    card.querySelector('[data-copy]').onclick = async () => {
      await navigator.clipboard.writeText(roomPath(room.id));
      el.createStatus.textContent = 'link copied';
    };
    el.roomList.appendChild(card);
  });
}
async function loadMyRooms() {
  const { rooms } = await api(`/api/rooms?clientId=${encodeURIComponent(state.clientId)}`);
  renderRooms(rooms);
}
async function createRoom() {
  const name = el.createName.value.trim();
  const nickname = el.createNickname.value.trim() || 'host';
  if (!name) { el.createStatus.textContent = 'room name required'; return; }
  try {
    const { room } = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name, clientId: state.clientId, nickname }) });
    el.createStatus.textContent = 'room created';
    el.createName.value = '';
    await loadMyRooms();
    await openRoom(room.id);
  } catch (err) {
    el.createStatus.textContent = err.message;
  }
}
async function openRoom(roomId) { history.pushState({}, '', `/room/${roomId}`); await route(); }
async function route() {
  const match = window.location.pathname.match(/^\/room\/([^/]+)$/);
  if (!match) { setView('welcomeView'); state.currentRoom = null; disconnectSocket(); return; }
  const roomId = match[1];
  try {
    const { room } = await api(`/api/rooms/${roomId}?clientId=${encodeURIComponent(state.clientId)}`);
    const myRooms = await api(`/api/rooms?clientId=${encodeURIComponent(state.clientId)}`);
    const alreadyJoined = myRooms.rooms.some(r => r.id === roomId);
    if (alreadyJoined) {
      await enterChat(roomId, room.nickname || localStorage.getItem(`nickname:${roomId}`) || 'guest');
    } else {
      setView('joinView');
      el.joinRoomName.textContent = room.name;
      el.joinStatus.textContent = `${room.activeParticipantCount}/${room.maxParticipants} active · ${fmtRemaining(room.expiresAt)}`;
      el.joinNickname.value = localStorage.getItem(`nickname:${roomId}`) || '';
      disconnectSocket();
    }
  } catch {
    setView('welcomeView');
    el.createStatus.textContent = 'room not found or expired';
  }
}
async function joinRoomFromPrompt() {
  const roomId = window.location.pathname.split('/').pop();
  const nickname = el.joinNickname.value.trim();
  if (!nickname) { el.joinStatus.textContent = 'nickname required'; return; }
  try {
    await api(`/api/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ clientId: state.clientId, nickname }) });
    localStorage.setItem(`nickname:${roomId}`, nickname);
    await loadMyRooms();
    await enterChat(roomId, nickname);
  } catch (err) {
    el.joinStatus.textContent = err.message;
  }
}
async function enterChat(roomId, nickname) {
  const [{ room }, { messages }] = await Promise.all([api(`/api/rooms/${roomId}?clientId=${encodeURIComponent(state.clientId)}`), api(`/api/rooms/${roomId}/messages`)]);
  state.currentRoom = room;
  setView('chatView');
  el.chatRoomName.textContent = `> ${room.name}`;
  el.chatMeta.textContent = `${room.activeParticipantCount}/${room.maxParticipants} active · ${fmtRemaining(room.expiresAt)}`;
  renderMessages(messages);
  connectSocket(roomId, nickname);
  setTimeout(() => el.messageInput.focus(), 0);
}
function renderMessages(messages) {
  el.messages.innerHTML = '';
  messages.forEach(appendMessage);
  el.messages.scrollTop = el.messages.scrollHeight;
}
function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.type === 'system' ? 'system' : ''}`;
  if (msg.type === 'system') div.innerHTML = `<span class="time">[${fmtTime(msg.createdAt)}]</span> system &gt; ${escapeHtml(msg.content)}`;
  else div.innerHTML = `<span class="time">[${fmtTime(msg.createdAt)}]</span> <span class="name">${escapeHtml(msg.senderNickname)}</span> &gt; ${escapeHtml(msg.content)}`;
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
}
function connectSocket(roomId, nickname) {
  disconnectSocket();
  state.socket = io();
  state.socket.on('connect', () => {
    el.chatStatus.textContent = 'connected';
    state.socket.emit('room:join', { roomId, clientId: state.clientId, nickname });
  });
  state.socket.on('message:new', appendMessage);
  state.socket.on('room:update', (room) => {
    if (state.currentRoom && room.id === state.currentRoom.id) {
      state.currentRoom = room;
      el.chatMeta.textContent = `${room.activeParticipantCount}/${room.maxParticipants} active · ${fmtRemaining(room.expiresAt)}`;
      loadMyRooms().catch(() => {});
    }
  });
  state.socket.on('room:expired', () => {
    el.chatStatus.textContent = 'room expired';
    disconnectSocket();
    history.pushState({}, '', '/');
    route();
  });
  state.socket.on('room:deleted', () => {
    el.chatStatus.textContent = 'room deleted';
    disconnectSocket();
    history.pushState({}, '', '/');
    loadMyRooms().catch(() => {});
    route();
  });
  state.socket.on('room:error', ({ message }) => { el.chatStatus.textContent = message; });
  state.socket.on('disconnect', () => { el.chatStatus.textContent = 'connection lost'; });
}
function disconnectSocket() { if (state.socket) { state.socket.disconnect(); state.socket = null; } }
async function leaveCurrentRoom() {
  if (!state.currentRoom) return;
  try {
    await api(`/api/rooms/${state.currentRoom.id}/leave`, { method: 'POST', body: JSON.stringify({ clientId: state.clientId }) });
  } catch {}
  disconnectSocket();
  history.pushState({}, '', '/');
  state.currentRoom = null;
  await loadMyRooms();
  await route();
}
el.createBtn.addEventListener('click', createRoom);
el.joinBtn.addEventListener('click', joinRoomFromPrompt);
el.copyBtn.addEventListener('click', async () => {
  if (!state.currentRoom) return;
  await navigator.clipboard.writeText(roomPath(state.currentRoom.id));
  el.chatStatus.textContent = 'link copied';
});
el.leaveBtn.addEventListener('click', leaveCurrentRoom);
el.messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = el.messageInput.value.trim();
  if (!content || !state.socket || !state.currentRoom) return;
  state.socket.emit('message:send', { roomId: state.currentRoom.id, clientId: state.clientId, content });
  el.messageInput.value = '';
});
window.addEventListener('popstate', route);
(async function bootstrap() {
  await initSession();
  await loadMyRooms();
  await route();
})();
