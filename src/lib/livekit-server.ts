import "server-only";
import { AccessToken, RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";

const livekitUrl = process.env.LIVEKIT_URL!;
const apiKey = process.env.LIVEKIT_API_KEY!;
const apiSecret = process.env.LIVEKIT_API_SECRET!;

// Convert wss:// → https:// for REST API calls
const httpUrl = livekitUrl
  .replace("wss://", "https://")
  .replace("ws://", "http://");

export const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
export const agentDispatchService = new AgentDispatchClient(httpUrl, apiKey, apiSecret);

/**
 * Generate a signed JWT token for a participant to join a LiveKit room.
 * Tokens expire after 2 hours.
 */
export async function generateLiveKitToken(
  identity: string,
  name: string,
  roomName: string
): Promise<string> {
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "2h",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}
