import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";

// RoomServiceClient uses HTTP/HTTPS, NOT WebSocket.
// Must convert wss:// → https:// before passing to the client.
const livekitHttpUrl = (process.env.LIVEKIT_URL || "")
  .replace("wss://", "https://")
  .replace("ws://", "http://");

export const livekitRoomService = new RoomServiceClient(
  livekitHttpUrl,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);
