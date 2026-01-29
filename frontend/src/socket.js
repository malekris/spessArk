import { io } from "socket.io-client";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export const socket = io(API, {
  autoConnect: false, // we connect manually after login
});
