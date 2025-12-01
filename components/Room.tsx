import React, { useEffect, useRef, useState } from 'react';
import { 
  Mic, MicOff, Monitor, PhoneOff, Video, VideoOff, 
  Copy, Check, Link as LinkIcon, MessageSquare, Send, X, AlertCircle, RefreshCw, Settings, Signal, Activity, Layers, ArrowLeftRight
} from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { UserConfig, ChatMessage } from '../types';
import { Button } from './Button';

interface RoomProps {
  roomId: string;
  config: UserConfig;
  onLeave: () => void;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

type ConnectionStatus = 'Initializing' | 'Waiting for Peer' | 'Negotiating' | 'Connected' | 'Reconnecting' | 'Disconnected' | 'Failed';
type VideoQuality = 'low' | 'standard' | 'hd';
type ScreenShareType = 'monitor' | 'window' | 'browser';

export const Room: React.FC<RoomProps> = ({ roomId, config, onLeave }) => {
  // --- State: Connection & Media ---
  const [status, setStatus] = useState<ConnectionStatus>('Initializing');
  const [statusMessage, setStatusMessage] = useState<string>('Setting up room...');
  const [detailedStatus, setDetailedStatus] = useState({ ice: 'New', signal: 'Stable', gathering: 'New' });
  
  const [peerConnected, setPeerConnected] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  
  // --- State: Persistence (LocalStorage) ---
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('p2p_isMuted') === 'true');
  const [isVideoOff, setIsVideoOff] = useState(() => localStorage.getItem('p2p_isVideoOff') === 'true');
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('standard');
  
  // --- State: UI & Chat ---
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  // --- State: View Management ---
  // If true, Local Video is Big, Remote Video is Small (PiP)
  const [isSwapped, setIsSwapped] = useState(false);

  // --- Refs ---
  const myId = useRef(Math.random().toString(36).substring(7));
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<any>(null);
  const isInitiator = useRef(false);
  const announceInterval = useRef<any>(null);
  const negotiationTimeout = useRef<any>(null);
  
  // Media Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // ICE Queue
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (showChat) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
    }
  }, [messages, showChat]);

  // Persist Media Settings
  useEffect(() => {
    localStorage.setItem('p2p_isMuted', String(isMuted));
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !isMuted);
    }
  }, [isMuted]);

  useEffect(() => {
    localStorage.setItem('p2p_isVideoOff', String(isVideoOff));
    // We only toggle the CAMERA video track, not the screen share track
    if (localStreamRef.current && !isScreenSharing) {
       localStreamRef.current.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
    }
  }, [isVideoOff, isScreenSharing]);

  // --- Video Quality Helper ---
  const applyVideoQuality = async (quality: VideoQuality) => {
    setVideoQuality(quality);
    if (!localStreamRef.current || isScreenSharing) return;

    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;

    let constraints: MediaTrackConstraints = {};
    switch (quality) {
        case 'low':
            constraints = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } };
            break;
        case 'standard':
            constraints = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
            break;
        case 'hd':
            constraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
            break;
    }

    try {
        await videoTrack.applyConstraints(constraints);
    } catch (err) {
        console.warn("Could not apply video constraints:", err);
    }
  };

  // --- Media Initialization ---
  const startMedia = async () => {
    setMediaError(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 640 }, height: { ideal: 480 } }, // Default standard
            audio: true 
        });
      } catch (err) {
        console.warn("Video access failed, trying audio only...", err);
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setMediaError("Camera not found, audio only mode.");
      }
      
      localStreamRef.current = stream;

      // Apply initial settings
      stream.getAudioTracks().forEach(track => track.enabled = !isMuted);
      if (!isScreenSharing) {
          stream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true; // Always mute local video to avoid echo
      }
      
      // Update PeerConnection if exists
      if (peerConnection.current) {
         const senders = peerConnection.current.getSenders();
         stream.getTracks().forEach(track => {
             const sender = senders.find(s => s.track?.kind === track.kind);
             if (sender) {
                 sender.replaceTrack(track);
             } else {
                 try {
                    peerConnection.current?.addTrack(track, stream);
                 } catch (e) { console.warn("Could not add track", e); }
             }
         });
      }

      return stream;
    } catch (err: any) {
      console.error("Error accessing media devices:", err);
      let errorMsg = "Could not access media devices.";
      if (err.name === 'NotAllowedError') errorMsg = "Permissions denied.";
      else if (err.name === 'NotFoundError') errorMsg = "No device found.";
      else if (err.name === 'NotReadableError') errorMsg = "Device is busy.";
      
      setMediaError(errorMsg);
      return null;
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputMessage.trim()) return;

    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      text: inputMessage,
      senderId: myId.current,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, msg]);
    setInputMessage('');

    if (channel.current) {
      await channel.current.send({
        type: 'broadcast',
        event: 'signal',
        payload: { type: 'chat', chatMessage: msg, senderId: myId.current },
      });
    }
  };

  // --- Signal Handler ---
  const handleSignalMessage = async (payload: any) => {
      // Don't process our own messages
      if (payload.senderId === myId.current) return;
      
      // Console log to debug signal reception
      // console.log("Received Signal:", payload.type, "From:", payload.senderId);

      // --- Chat Messages (Independent of WebRTC status) ---
      if (payload.type === 'chat' && payload.chatMessage) {
        setMessages(prev => {
            // Deduplicate based on ID just in case
            if (prev.some(m => m.id === payload.chatMessage.id)) return prev;
            return [...prev, payload.chatMessage];
        });
        if (!showChat) setUnreadCount(prev => prev + 1);
        return;
      }

      // --- WebRTC Signaling ---
      if (!peerConnection.current) return;

      try {
        if (payload.type === 'announce') {
            const pcState = peerConnection.current.connectionState;
            const sigState = peerConnection.current.signalingState;

            // If we are already securely connected, ignore announcements
            if (pcState === 'connected') return;

            // Determining Initiator
            if (myId.current > payload.senderId) {
                // I am the "Winner" (Initiator)
                // If I'm already offering/connecting, don't restart process unless failed
                if (sigState !== 'stable' && pcState !== 'failed' && pcState !== 'disconnected') {
                    // console.log("Ignoring announce, already negotiating...");
                    return;
                }

                console.log("Announcement received. I am Initiator. Calling peer...");
                initiateConnection();
            } else {
                // I am the "Follower"
                console.log("Announcement received. I am Follower. Waiting for offer...");
                // IMPORTANT FIX: Do NOT stop announcing yet. 
                // We keep announcing until we receive an OFFER.
                // This ensures if the Initiator fails to send offer, they will hear us again.
            }
        } 
        else if (payload.type === 'offer') {
          console.log("Received Offer");
          setStatus('Negotiating');
          setStatusMessage('Accepting connection...');
          
          // NOW we stop announcing, because we have a handshake
          if (announceInterval.current) {
            clearInterval(announceInterval.current);
            announceInterval.current = null;
          }

          // Handle Glare: If I also sent an offer, but I have a lower ID, I must yield.
          if (peerConnection.current.signalingState !== 'stable') {
             await Promise.all([
                peerConnection.current.setLocalDescription({type: "rollback"}),
                peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
             ]);
          } else {
             await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          }
          
          // Add queued candidates
          while (iceCandidatesQueue.current.length > 0) {
              const candidate = iceCandidatesQueue.current.shift();
              if (candidate) {
                  try {
                    await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
                  } catch (e) { console.warn("Failed to add queued candidate", e); }
              }
          }

          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          
          channel.current.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'answer', sdp: answer, senderId: myId.current },
          });

        } else if (payload.type === 'answer') {
          console.log("Received Answer");
          setStatus('Negotiating');
          setStatusMessage('Finalizing connection...');
          // Only set remote if we are in a state expecting it
          if (peerConnection.current.signalingState === 'have-local-offer') {
              await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          }
          
        } else if (payload.type === 'ice-candidate') {
          if (payload.candidate) {
            if (peerConnection.current.remoteDescription && peerConnection.current.remoteDescription.type) {
                try {
                    await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
                } catch (e) { console.warn("Error adding candidate", e); }
            } else {
                iceCandidatesQueue.current.push(payload.candidate);
            }
          }
        } else if (payload.type === 'leave') {
            handleRemoteDisconnect();
        }
      } catch (e) {
        console.error('Signaling error:', e);
        // If a fatal signaling error occurs, restart
        if (payload.type === 'offer' || payload.type === 'answer') {
             restartConnection();
        }
      }
  };

  const initiateConnection = async () => {
      if (!peerConnection.current) return;
      
      // Stop announcing once we decide to call
      if (announceInterval.current) {
        clearInterval(announceInterval.current);
        announceInterval.current = null;
      }

      setStatus('Negotiating');
      setStatusMessage('Calling peer...');
      isInitiator.current = true;

      try {
        // Data channel is required for connection to establish if audio/video fails
        peerConnection.current.createDataChannel('keepalive');

        const offer = await peerConnection.current.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        
        await peerConnection.current.setLocalDescription(offer);
        
        channel.current.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'offer', sdp: offer, senderId: myId.current },
        });

        // Set a timeout to reset if no answer received
        if (negotiationTimeout.current) clearTimeout(negotiationTimeout.current);
        negotiationTimeout.current = setTimeout(() => {
            const pcState = peerConnection.current?.connectionState;
            const iceState = peerConnection.current?.iceConnectionState;
            
            if (pcState !== 'connected' && iceState !== 'connected') {
                console.log("Negotiation timed out. Retrying...");
                restartConnection();
            }
        }, 10000);

      } catch (e) {
          console.error("Error initiating connection", e);
      }
  };

  const restartConnection = () => {
      console.log("Restarting connection...");
      if (peerConnection.current) {
          peerConnection.current.close();
          peerConnection.current = null;
      }
      createPeerConnection();
      if (localStreamRef.current && peerConnection.current) {
        localStreamRef.current.getTracks().forEach(track => {
            try {
                peerConnection.current?.addTrack(track, localStreamRef.current!);
            } catch(e) { console.error("Error adding initial tracks", e); }
        });
      }
      setStatus('Waiting for Peer');
      setStatusMessage('Retrying connection...');
      startAnnouncementLoop();
  };

  const handleRemoteDisconnect = () => {
    setStatus('Waiting for Peer');
    setStatusMessage('Peer left. Waiting...');
    setPeerConnected(false);
    if(remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    restartConnection();
  };

  const createPeerConnection = () => {
      if (peerConnection.current) return;
      
      console.log("Creating RTCPeerConnection");
      peerConnection.current = new RTCPeerConnection(ICE_SERVERS);
      
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          channel.current?.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'ice-candidate', candidate: event.candidate, senderId: myId.current },
          });
          setDetailedStatus(prev => ({ ...prev, ice: 'Gathering...' }));
        }
      };
      
      peerConnection.current.ontrack = (event) => {
        console.log("Track received", event.streams[0]);
        if (event.streams && event.streams[0]) {
             if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0];
                remoteVideoRef.current.play().catch(e => console.log("Auto-play blocked", e));
             }
             setPeerConnected(true);
        }
      };
      
      peerConnection.current.oniceconnectionstatechange = () => {
          setDetailedStatus(prev => ({ ...prev, ice: peerConnection.current?.iceConnectionState || '-' }));
      };
      
      peerConnection.current.onsignalingstatechange = () => {
           setDetailedStatus(prev => ({ ...prev, signal: peerConnection.current?.signalingState || '-' }));
      };

      peerConnection.current.onconnectionstatechange = () => {
        const state = peerConnection.current?.connectionState;
        console.log("Connection State Change:", state);
        if (state === 'connected') {
            setStatus('Connected');
            setStatusMessage('Securely connected');
            setPeerConnected(true);
            // Ensure announcement loop is killed upon success
            if (announceInterval.current) clearInterval(announceInterval.current);
            if (negotiationTimeout.current) clearTimeout(negotiationTimeout.current);
        } else if (state === 'disconnected') {
            setStatus('Disconnected');
            setStatusMessage('Peer disconnected');
            setPeerConnected(false);
        } else if (state === 'failed') {
            setStatus('Failed');
            setStatusMessage('Connection failed. Retrying...');
            setTimeout(restartConnection, 2000); 
        }
      };
  };

  const startAnnouncementLoop = () => {
      if (announceInterval.current) clearInterval(announceInterval.current);
      
      // Initial broadcast
      setTimeout(() => {
          if (peerConnection.current?.connectionState !== 'connected') {
             console.log("Broadcasting presence...");
             channel.current?.send({
                type: 'broadcast',
                event: 'signal',
                payload: { type: 'announce', senderId: myId.current },
             }).catch((e: any) => console.log("Broadcast failed", e));
          }
      }, 500);

      announceInterval.current = setInterval(() => {
          if (peerConnection.current?.connectionState === 'connected') {
              clearInterval(announceInterval.current);
              return;
          }
          
          console.log("Broadcasting presence...");
          channel.current?.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'announce', senderId: myId.current },
          }).catch((e: any) => console.log("Broadcast failed", e));
      }, 2000);
  };

  // --- Main Init ---
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setStatus('Initializing');
      createPeerConnection();
      const stream = await startMedia();

      if (stream && peerConnection.current) {
          stream.getTracks().forEach(track => {
              try {
                  peerConnection.current?.addTrack(track, stream);
              } catch(e) { console.error("Error adding initial tracks", e); }
          });
      }

      const supabase = getSupabase(config.supabaseUrl, config.supabaseKey);
      
      if (channel.current) supabase.removeChannel(channel.current);

      channel.current = supabase.channel(`room:${roomId}`, {
          config: {
            broadcast: { self: false } 
          }
      });

      channel.current
        .on('broadcast', { event: 'signal' }, ({ payload }: { payload: any }) => {
            if (mounted) handleSignalMessage(payload);
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.log("Subscribed to Supabase channel");
            if (mounted) {
                setStatus('Waiting for Peer');
                setStatusMessage('Searching for peer...');
                startAnnouncementLoop();
            }
          } else {
             console.log("Supabase Channel Status:", status);
          }
        });
    };

    init();

    return () => {
        mounted = false;
        if (announceInterval.current) clearInterval(announceInterval.current);
        if (negotiationTimeout.current) clearTimeout(negotiationTimeout.current);
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        peerConnection.current?.close();
        peerConnection.current = null;
        if(channel.current) {
            channel.current.send({
                type: 'broadcast',
                event: 'signal',
                payload: { type: 'leave', senderId: myId.current },
            }).catch(() => {});
            channel.current.unsubscribe();
            channel.current = null;
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // --- Media Controls ---
  const toggleMute = () => {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = !newMuted);
  };

  const toggleVideo = () => {
      const newVideoOff = !isVideoOff;
      setIsVideoOff(newVideoOff);
      if (!isScreenSharing && localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !newVideoOff);
      }
  };

  const stopScreenShare = () => {
      if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(t => t.stop());
          screenStreamRef.current = null;
      }

      if (peerConnection.current && localStreamRef.current) {
          const senders = peerConnection.current.getSenders();
          const videoSender = senders.find(s => s.track?.kind === 'video');
          const cameraTrack = localStreamRef.current.getVideoTracks()[0];
          
          if (videoSender && cameraTrack) {
              videoSender.replaceTrack(cameraTrack);
              cameraTrack.enabled = !isVideoOff;
              applyVideoQuality(videoQuality); 
          }
      }

      if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
      }

      setIsScreenSharing(false);
  };

  const startScreenShare = async (displaySurface?: ScreenShareType) => {
    setShowShareModal(false);
    
    if (isScreenSharing) {
        stopScreenShare();
        return;
    }

    try {
      // @ts-ignore: displaySurface is a valid constraint in modern browsers
      const constraints: MediaStreamConstraints = {
          video: {
              displaySurface: displaySurface || undefined
          },
          audio: true // Request system audio
      };

      const screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
      screenStreamRef.current = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];

      screenTrack.onended = () => {
          stopScreenShare();
      };

      if (peerConnection.current) {
        const senders = peerConnection.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        
        if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
        } else {
            peerConnection.current.addTrack(screenTrack, screenStream);
        }
      }

      if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
      }
      
      setIsScreenSharing(true);
    } catch (err) {
      console.error("Error sharing screen:", err);
    }
  };

  const copyRoomLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const getStatusColor = () => {
      switch(status) {
          case 'Connected': return 'bg-green-500';
          case 'Disconnected': 
          case 'Failed': return 'bg-red-500';
          case 'Negotiating': return 'bg-yellow-400';
          case 'Waiting for Peer': return 'bg-blue-400 animate-pulse';
          default: return 'bg-slate-500';
      }
  };

  const fullscreenClasses = "absolute inset-0 w-full h-full object-contain z-0 transition-all duration-300";
  const pipClasses = "absolute bottom-24 right-4 md:bottom-24 md:left-6 md:right-auto w-32 h-48 md:w-56 md:h-36 bg-black rounded-xl border border-slate-700 z-50 shadow-2xl transition-all duration-300 cursor-pointer hover:border-primary/50 group overflow-hidden";

  return (
    <div className="flex flex-col w-full bg-background relative overflow-hidden h-[100dvh]">
      
      {/* --- Top Bar --- */}
      <div className="absolute top-0 left-0 right-0 p-4 z-40 bg-gradient-to-b from-black/90 to-transparent flex justify-between items-start pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg max-w-[50%]">
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor()} shrink-0`} />
            <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold text-white leading-none truncate">{status}</span>
                <span className="text-[10px] text-slate-300 font-medium truncate">{statusMessage}</span>
            </div>
        </div>
        
        <div className="pointer-events-auto flex items-center gap-2">
             <div className="bg-surface/80 backdrop-blur border border-white/5 px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-lg">
                <span className="text-xs text-slate-400 font-mono hidden sm:inline">ID: {roomId}</span>
                <button 
                  onClick={copyRoomLink} 
                  className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors hover:bg-white/10 px-2 py-1 rounded"
                  title="Copy Join Link"
                >
                    {copied ? <Check size={14} className="text-green-400" /> : <LinkIcon size={14} />}
                </button>
             </div>
        </div>
      </div>

      {/* --- Main Content Area --- */}
      <div className="flex-1 flex overflow-hidden relative bg-black">
        
        {/* --- Video Layers --- */}
        <div className={`w-full h-full relative transition-all duration-300 ${showChat || showSettings ? 'md:mr-80' : ''}`}>
             
            {/* 1. REMOTE VIDEO */}
            <div 
                className={isSwapped ? pipClasses : fullscreenClasses}
                onClick={() => isSwapped && setIsSwapped(false)}
            >
                {peerConnected ? (
                    <video 
                        ref={remoteVideoRef} 
                        autoPlay 
                        playsInline 
                        className="w-full h-full object-contain bg-black"
                    />
                ) : (
                    !isSwapped && (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-6 animate-fade-in z-10 relative">
                            <div className="relative">
                                <div className="w-24 h-24 rounded-full bg-surface border border-slate-700 flex items-center justify-center animate-pulse">
                                    {status === 'Waiting for Peer' ? <Signal size={32} className="animate-pulse" /> : <VideoOff size={32} />}
                                </div>
                            </div>
                            <div className="text-center px-4">
                                <p className="text-xl font-bold text-slate-200 mb-2">{status}</p>
                                <p className="text-sm text-slate-400">
                                    {status === 'Waiting for Peer' ? 'Waiting for someone to join...' : statusMessage}
                                </p>
                            </div>
                            <div 
                                className="flex items-center justify-between bg-black/40 p-4 rounded-xl border border-white/10 cursor-pointer hover:border-primary/50 transition-all group hover:bg-black/60 shadow-lg max-w-[90%]" 
                                onClick={copyRoomLink}
                            >
                                <code className="text-primary font-bold text-sm truncate mr-4">
                                    {window.location.href.split('?')[0]}?room={roomId}
                                </code>
                                <Copy size={18} className="text-slate-500 group-hover:text-white transition-colors shrink-0" />
                            </div>
                        </div>
                    )
                )}
                {isSwapped && <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white backdrop-blur border border-white/10">Remote</div>}
                
                {isSwapped && (
                     <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                         <ArrowLeftRight className="text-white" size={24} />
                     </div>
                )}
            </div>

            {/* 2. LOCAL VIDEO */}
            <div 
                className={!isSwapped ? pipClasses : fullscreenClasses}
                onClick={() => !isSwapped && setIsSwapped(true)}
            >
                {!mediaError ? (
                    <>
                        <video 
                            ref={localVideoRef} 
                            autoPlay 
                            playsInline 
                            muted
                            className={`w-full h-full object-cover bg-slate-900 ${isVideoOff && !isScreenSharing ? 'hidden' : 'block'} ${isScreenSharing ? '' : 'transform -scale-x-100'}`} 
                        />
                        {isVideoOff && !isScreenSharing && (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-500">
                                <VideoOff size={24} />
                                <span className="text-[10px] mt-2">Video Off</span>
                            </div>
                        )}
                        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white backdrop-blur border border-white/10">
                            {isScreenSharing ? 'You (Screen)' : 'You'}
                        </div>
                        
                        {!isSwapped && (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <ArrowLeftRight className="text-white" size={24} />
                            </div>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/20 text-red-400 p-2 text-center">
                        <AlertCircle size={24} className="mb-2" />
                        <span className="text-[10px] leading-tight mb-2">{mediaError}</span>
                        <button onClick={(e) => { e.stopPropagation(); startMedia(); }} className="text-[10px] bg-red-500/20 hover:bg-red-500/40 px-2 py-1 rounded text-white transition-colors">
                            Retry
                        </button>
                    </div>
                )}
            </div>
        </div>

        {/* --- Chat Panel --- */}
        <div className={`
            fixed right-0 top-0 h-full w-full md:w-80 z-[60] bg-surface/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 flex flex-col
            ${showChat ? 'translate-x-0' : 'translate-x-full'}
        `}>
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-black/20 pt-safe">
                <h3 className="font-bold text-white flex items-center gap-2">
                    <MessageSquare size={18} /> Chat
                </h3>
                <button onClick={() => setShowChat(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
                    <X size={20} />
                </button>
            </div>
            
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/40">
                {messages.length === 0 && (
                    <div className="text-center text-slate-500 text-sm mt-10">
                        <p>No messages yet.</p>
                        <p className="text-xs mt-1 opacity-70">Say hello to start the conversation!</p>
                    </div>
                )}
                {messages.map((msg, idx) => {
                    const isMe = msg.senderId === myId.current;
                    return (
                        <div key={msg.id || idx} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                             <div className={`
                                max-w-[85%] px-3 py-2 rounded-2xl text-sm break-words
                                ${isMe ? 'bg-primary text-white rounded-br-none' : 'bg-slate-700 text-slate-200 rounded-bl-none'}
                             `}>
                                {msg.text}
                             </div>
                             <span className="text-[10px] text-slate-500 mt-1 px-1">
                                {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                             </span>
                        </div>
                    );
                })}
                <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSendMessage} className="p-4 bg-black/20 border-t border-white/10 pb-safe mb-safe">
                <div className="relative">
                    <input
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder="Type a message..."
                        className="w-full bg-slate-800/50 border border-slate-700 rounded-full pl-4 pr-12 py-3 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-500"
                    />
                    <button 
                        type="submit" 
                        disabled={!inputMessage.trim()}
                        className="absolute right-1.5 top-1.5 p-1.5 bg-primary text-white rounded-full disabled:opacity-50 disabled:bg-slate-700 transition-all hover:bg-blue-600"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </form>
        </div>

        {/* --- Settings Panel --- */}
        <div className={`
            fixed right-0 top-0 h-full w-full md:w-80 z-[60] bg-surface/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 flex flex-col
            ${showSettings ? 'translate-x-0' : 'translate-x-full'}
        `}>
             <div className="p-4 border-b border-white/10 flex justify-between items-center bg-black/20 pt-safe">
                <h3 className="font-bold text-white flex items-center gap-2">
                    <Settings size={18} /> Settings
                </h3>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
                    <X size={20} />
                </button>
            </div>
            
            <div className="p-6 space-y-8 overflow-y-auto pb-safe flex-1 bg-gradient-to-b from-surface/50 to-black/20">
                {/* Video Quality Section */}
                <div>
                    <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                        <Activity size={16} /> Video Quality
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                        {(['low', 'standard', 'hd'] as const).map((q) => (
                            <button
                                key={q}
                                onClick={() => applyVideoQuality(q)}
                                className={`
                                    px-4 py-3 rounded-xl border text-left transition-all flex justify-between items-center
                                    ${videoQuality === q 
                                        ? 'bg-primary/20 border-primary text-white' 
                                        : 'bg-black/20 border-slate-700 text-slate-400 hover:bg-black/40'}
                                `}
                            >
                                <div>
                                    <div className="font-medium capitalize">{q}</div>
                                    <div className="text-xs opacity-70 mt-0.5">
                                        {q === 'low' && '360p (Bandwidth saver)'}
                                        {q === 'standard' && '480p (Balanced)'}
                                        {q === 'hd' && '720p (High Definition)'}
                                    </div>
                                </div>
                                {videoQuality === q && <Check size={16} className="text-primary" />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Network Stats Section */}
                <div>
                    <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                        <Signal size={16} /> Network Info
                    </h4>
                    <div className="bg-black/40 rounded-xl p-4 border border-white/5 space-y-3 font-mono text-xs">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Status</span>
                            <span className={`font-bold ${status === 'Connected' ? 'text-green-400' : 'text-yellow-400'}`}>{status}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">ICE Connection</span>
                            <span className="text-slate-300 capitalize">{detailedStatus.ice}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Signaling</span>
                            <span className="text-slate-300 capitalize">{detailedStatus.signal}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-white/10">
                            <span className="text-slate-500">Protocol</span>
                            <span className="text-slate-300">WebRTC (P2P)</span>
                        </div>
                         <div className="flex justify-between">
                             <span className="text-slate-500">Room ID</span>
                             <span className="text-slate-300">{roomId}</span>
                        </div>
                    </div>
                    
                    <button 
                        onClick={() => restartConnection()}
                        className="mt-4 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs flex items-center justify-center gap-2 transition-colors"
                    >
                        <RefreshCw size={12} /> Force Reconnect
                    </button>
                </div>
            </div>
        </div>
      </div>

      {/* --- Screen Share Modal --- */}
      {showShareModal && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-surface border border-slate-700 p-6 rounded-2xl w-full max-w-md shadow-2xl">
                  <h3 className="text-xl font-bold text-white mb-2">Share your screen</h3>
                  <p className="text-slate-400 text-sm mb-6">Choose what you want to share with the room.</p>
                  
                  <div className="space-y-3">
                      <button 
                        onClick={() => startScreenShare('browser')}
                        className="w-full flex items-center gap-4 p-4 rounded-xl bg-black/20 border border-slate-700 hover:bg-black/40 hover:border-primary/50 transition-all text-left group"
                      >
                          <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                            <Layers size={24} />
                          </div>
                          <div>
                              <div className="font-semibold text-white">Specific Tab</div>
                              <div className="text-xs text-slate-500 mt-0.5">Best for sharing video or audio</div>
                          </div>
                      </button>

                      <button 
                        onClick={() => startScreenShare('window')}
                        className="w-full flex items-center gap-4 p-4 rounded-xl bg-black/20 border border-slate-700 hover:bg-black/40 hover:border-primary/50 transition-all text-left group"
                      >
                          <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                            <Monitor size={24} />
                          </div>
                          <div>
                              <div className="font-semibold text-white">Specific Window</div>
                              <div className="text-xs text-slate-500 mt-0.5">Share a single application</div>
                          </div>
                      </button>

                      <button 
                        onClick={() => startScreenShare('monitor')}
                        className="w-full flex items-center gap-4 p-4 rounded-xl bg-black/20 border border-slate-700 hover:bg-black/40 hover:border-primary/50 transition-all text-left group"
                      >
                          <div className="p-3 rounded-lg bg-green-500/10 text-green-400 group-hover:bg-green-500 group-hover:text-white transition-colors">
                            <Monitor size={24} />
                          </div>
                          <div>
                              <div className="font-semibold text-white">Entire Screen</div>
                              <div className="text-xs text-slate-500 mt-0.5">Share everything on your monitor</div>
                          </div>
                      </button>
                  </div>

                  <button 
                    onClick={() => setShowShareModal(false)}
                    className="mt-6 w-full py-3 text-slate-400 hover:text-white text-sm font-medium transition-colors"
                  >
                      Cancel
                  </button>
              </div>
          </div>
      )}

      {/* --- Bottom Control Bar --- */}
      <div className="h-20 bg-surface/90 backdrop-blur-md border-t border-white/5 flex items-center justify-center gap-3 md:gap-4 px-4 pb-safe z-50">
        <Button 
            variant={isMuted ? 'danger' : 'secondary'} 
            onClick={toggleMute}
            className="rounded-full w-10 h-10 md:w-12 md:h-12 p-0 flex items-center justify-center shadow-lg shrink-0"
            title={isMuted ? "Unmute" : "Mute"}
        >
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </Button>
        
        <Button 
            variant={isVideoOff ? 'danger' : 'secondary'} 
            onClick={toggleVideo}
            className="rounded-full w-10 h-10 md:w-12 md:h-12 p-0 flex items-center justify-center shadow-lg shrink-0"
            title={isVideoOff ? "Turn Video On" : "Turn Video Off"}
        >
            {isVideoOff ? <VideoOff size={18} /> : <Video size={18} />}
        </Button>

        <Button 
            variant={isScreenSharing ? 'primary' : 'secondary'} 
            onClick={() => isScreenSharing ? stopScreenShare() : setShowShareModal(true)}
            className={`rounded-full w-12 h-12 md:w-14 md:h-14 p-0 flex items-center justify-center shadow-xl shrink-0 ${isScreenSharing ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900' : ''}`}
            title="Share Screen"
        >
            <Monitor size={22} />
        </Button>

        <div className="relative shrink-0">
            <Button
                variant={showChat ? 'primary' : 'secondary'}
                onClick={() => { setShowChat(!showChat); setShowSettings(false); }}
                className="rounded-full w-10 h-10 md:w-12 md:h-12 p-0 flex items-center justify-center shadow-lg"
                title="Chat"
            >
                <MessageSquare size={18} />
            </Button>
            {unreadCount > 0 && !showChat && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-surface animate-bounce">
                    {unreadCount > 9 ? '9+' : unreadCount}
                </div>
            )}
        </div>

        <Button
            variant={showSettings ? 'primary' : 'secondary'}
            onClick={() => { setShowSettings(!showSettings); setShowChat(false); }}
            className="rounded-full w-10 h-10 md:w-12 md:h-12 p-0 flex items-center justify-center shadow-lg shrink-0"
            title="Settings"
        >
            <Settings size={18} />
        </Button>

        <div className="w-px h-8 bg-white/10 mx-1 md:mx-2 shrink-0" />

        <Button 
            variant="danger" 
            onClick={onLeave}
            className="rounded-full w-10 h-10 md:w-12 md:h-12 p-0 flex items-center justify-center shadow-lg hover:rotate-90 transition-transform duration-300 shrink-0"
            title="Leave Call"
        >
            <PhoneOff size={18} />
        </Button>
      </div>
    </div>
  );
};