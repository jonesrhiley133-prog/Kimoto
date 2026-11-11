import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}
export function getSocket() {
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
