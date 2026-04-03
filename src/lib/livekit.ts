import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";

// Server-side LiveKit client — used for room creation and management
export const livekitRoomService = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);
