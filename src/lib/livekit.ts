import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";

const livekitUrl = process.env.LIVEKIT_URL!;

// RoomServiceClient requires an HTTP URL, not WebSocket
const httpUrl = livekitUrl
  .replace("wss://", "https://")
  .replace("ws://", "http://");

// Server-side LiveKit client — used for room creation and management
export const livekitRoomService = new RoomServiceClient(
  httpUrl,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);
