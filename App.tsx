import React, { useState, useEffect } from 'react';
import { Room } from './components/Room';
import { Button } from './components/Button';
import { Share2, Zap, ShieldCheck } from 'lucide-react';
import { UserConfig } from './types';

// ------------------------------------------------------------------
// CONFIGURATION
// Paste your Supabase project details here.
// You can find these in your Supabase Dashboard -> Project Settings -> API
// ------------------------------------------------------------------
const SUPABASE_URL = 'https://cfyodqlcjzghsojtmvgi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmeW9kcWxjanpnaHNvanRtdmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1NDM4ODIsImV4cCI6MjA4MDExOTg4Mn0.ZpoIxp8V_HMyj6bAG2fQjKLAdfRwqt_mrk3nodDbO2Y';
// ------------------------------------------------------------------

function App() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  
  const config: UserConfig = {
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_ANON_KEY
  };

  // Check URL for room param on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomId(roomParam);
      setInRoom(true);
    }
  }, []);

  const updateUrl = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('room', id);
    } else {
      url.searchParams.delete('room');
    }
    window.history.pushState({}, '', url.toString());
  };

  const handleCreateRoom = () => {
    const newId = Math.random().toString(36).substring(2, 9);
    setRoomId(newId);
    setInRoom(true);
    updateUrl(newId);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim().length > 0) {
      setInRoom(true);
      updateUrl(roomId);
    }
  };

  const handleLeave = () => {
    setInRoom(false);
    setRoomId('');
    updateUrl(null);
  };

  if (inRoom) {
    return (
      <Room 
        roomId={roomId} 
        config={config} 
        onLeave={handleLeave} 
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

      <div className="z-10 w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-tr from-primary to-blue-400 rounded-2xl mb-6 shadow-2xl shadow-blue-500/20 transform rotate-3">
            <Share2 size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-black text-white tracking-tight mb-2">
            P2P Connect
          </h1>
          <p className="text-slate-400 text-lg">
            Secure, serverless screen sharing & voice chat.
          </p>
        </div>

        <div className="bg-surface/50 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl">
          <div className="space-y-6">
            <Button 
              onClick={handleCreateRoom} 
              className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-primary to-blue-600 hover:to-blue-500 border-none"
            >
              <Zap className="mr-2" size={20} />
              Create New Room
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-surface text-slate-500">Or join existing</span>
              </div>
            </div>

            <form onSubmit={handleJoinRoom} className="flex gap-2">
              <input
                type="text"
                placeholder="Enter Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="flex-1 bg-black/20 border border-slate-700 rounded-xl px-4 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              />
              <Button type="submit" variant="secondary" disabled={roomId.length < 3}>
                Join
              </Button>
            </form>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-4 text-slate-500 text-xs text-center">
          <div className="flex flex-col items-center gap-2">
            <ShieldCheck size={20} className="text-green-500" />
            <span>End-to-End Encrypted (WebRTC)</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Zap size={20} className="text-yellow-500" />
            <span>Low Latency P2P Mesh</span>
          </div>
        </div>
        
        {(!SUPABASE_URL || SUPABASE_URL.includes('your-project')) && (
          <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
            <p className="text-red-400 text-sm font-medium">Configuration Missing</p>
            <p className="text-red-300/70 text-xs mt-1">
              Please open <code>App.tsx</code> and paste your Supabase keys in the constants at the top.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;