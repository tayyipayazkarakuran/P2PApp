export interface RoomState {
  roomId: string;
  isHost: boolean;
  joined: boolean;
}

export type SignalType = 'join' | 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'chat';

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface SignalMessage {
  type: SignalType;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  senderId: string;
  chatMessage?: ChatMessage;
}

export interface UserConfig {
  supabaseUrl: string;
  supabaseKey: string;
}