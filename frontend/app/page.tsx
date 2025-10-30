'use client';

import { useState } from 'react';
import VideoCall from '../components/VideoCall';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const [joinedRoom, setJoinedRoom] = useState('');

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      setJoinedRoom(roomId.trim());
    }
  };

  const handleLeaveRoom = () => {
    setJoinedRoom('');
    setRoomId('');
    // Reload the page to reset everything
    window.location.reload();
  };

  if (joinedRoom) {
    return (
      <div>
        <VideoCall roomId={joinedRoom} />
        <div style={{ padding: '20px' }}>
          <button
            onClick={handleLeaveRoom}
            style={{
              padding: '10px 20px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            Leave Room
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        maxWidth: '400px',
        width: '100%'
      }}>
        <h1 style={{ textAlign: 'center', marginBottom: '30px' }}>
          Video Call App
        </h1>
        
        <form onSubmit={handleJoinRoom}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              Room ID:
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter room ID"
              required
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '16px',
                border: '1px solid #ddd',
                borderRadius: '5px',
                boxSizing: 'border-box'
              }}
            />
          </div>
          
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              fontSize: '16px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Join Room
          </button>
        </form>
        
        <div style={{
          marginTop: '30px',
          padding: '15px',
          backgroundColor: '#e3f2fd',
          borderRadius: '5px',
          fontSize: '14px'
        }}>
          <strong>Instructions:</strong>
          <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
            <li>Enter a room ID to join</li>
            <li>Share the same room ID with others</li>
            <li>Allow camera and microphone access</li>
            <li>Multiple users can join the same room</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
