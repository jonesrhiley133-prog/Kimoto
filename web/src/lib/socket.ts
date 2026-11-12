import { io, type Socket } from 'socket.io-client';
import { getToken, isNative, serverUrl } from './native';

let socket: Socket | null = null;

export function connectSocket() {
  if (socket) return socket;
  const opts = { path: '/socket.io', transports: ['websocket', 'polling'] };
  // The app connects to its configured server with its token; the web app uses the same origin + cookie.
  socket = isNative ? io(serverUrl(), { ...opts, auth: { token: getToken() } }) : io({ ...opts, withCredentials: true });
  return socket;
}
export function getSocket() {
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
