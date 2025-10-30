'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface PeerConnection {
  userId: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
  iceCandidates: RTCIceCandidateInit[];
  remoteDescriptionSet: boolean;
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

const PC_CONFIG: RTCConfiguration = {
  ...ICE_SERVERS,
  iceTransportPolicy: 'all',
  rtcpMuxPolicy: 'require',
  bundlePolicy: 'max-bundle',
};

export default function VideoCall({ roomId }: { roomId: string }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map());
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  // Cleanup function
  const cleanup = useCallback(() => {
    // Close all peer connections
    peersRef.current.forEach((peer) => {
      try {
        peer.connection.close();
      } catch (error) {
        console.error('Error closing peer connection:', error);
      }
    });
    peersRef.current.clear();
    setPeers(new Map());

    // Stop local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      localStreamRef.current = null;
    }

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setHasJoinedRoom(false);
    setIsConnected(false);
  }, []);

  // Initialize socket connection with reconnection logic
  useEffect(() => {
    const initSocket = () => {
      if (socketRef.current?.connected) {
        return;
      }

      const socketInstance = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        transports: ['websocket', 'polling'],
        timeout: 20000,
      });

      socketRef.current = socketInstance;
      setSocket(socketInstance);

      socketInstance.on('connect', () => {
        console.log('✅ Connected to signaling server');
        setIsConnected(true);
        setConnectionError(null);

        // Rejoin room if we were in one
        if (hasJoinedRoom && localStreamRef.current) {
          socketInstance.emit('join-room', { roomId });
        }
      });

      socketInstance.on('disconnect', (reason) => {
        console.log('❌ Disconnected from signaling server:', reason);
        setIsConnected(false);

        // Attempt reconnection if not a manual disconnect
        if (reason === 'io server disconnect') {
          // Server disconnected, need to manually reconnect
          reconnectTimeoutRef.current = setTimeout(() => {
            initSocket();
          }, 2000);
        }
      });

      socketInstance.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setConnectionError('Failed to connect to server. Retrying...');
        setIsConnected(false);
      });

      socketInstance.on('reconnect', (attemptNumber) => {
        console.log('🔄 Reconnected after', attemptNumber, 'attempts');
        setIsConnected(true);
        setConnectionError(null);

        if (hasJoinedRoom && localStreamRef.current) {
          socketInstance.emit('join-room', { roomId });
        }
      });

      socketInstance.on('reconnect_error', (error) => {
        console.error('Reconnection error:', error);
      });

      socketInstance.on('reconnect_failed', () => {
        console.error('❌ Failed to reconnect to server');
        setConnectionError('Failed to reconnect to server. Please refresh the page.');
      });
    };

    initSocket();

    return () => {
      cleanup();
    };
  }, [roomId, hasJoinedRoom, cleanup]);

  // Get local media stream
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        localStreamRef.current = stream;
        setLocalStream(stream);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error: any) {
        console.error('Error accessing media devices:', error);
        const errorMessage =
          error.name === 'NotAllowedError'
            ? 'Camera/microphone access denied. Please allow access and refresh.'
            : error.name === 'NotFoundError'
            ? 'No camera/microphone found. Please connect a device.'
            : 'Could not access camera/microphone. Please check permissions.';
        setConnectionError(errorMessage);
      }
    };

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      getLocalStream();
    }

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  // Create peer connection with proper configuration
  const createPeerConnection = useCallback(
    (userId: string): RTCPeerConnection => {
      // Close existing connection if any
      const existingPeer = peersRef.current.get(userId);
      if (existingPeer) {
        try {
          existingPeer.connection.close();
        } catch (error) {
          console.error('Error closing existing connection:', error);
        }
      }

      const peerConnection = new RTCPeerConnection(PC_CONFIG);

      // Add local stream tracks to peer connection
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          if (track.enabled) {
            peerConnection.addTrack(track, localStreamRef.current!);
          }
        });
      }

      // Handle incoming tracks with proper stream management
      peerConnection.ontrack = (event) => {
        console.log('📹 Received remote track from', userId);
        const remoteStream = event.streams[0];

        if (!remoteStream) {
          console.warn('No remote stream in track event');
          return;
        }

        setPeers((prev) => {
          const newPeers = new Map(prev);
          const peer = newPeers.get(userId);
          if (peer) {
            peer.stream = remoteStream;
            newPeers.set(userId, peer);
          }
          return newPeers;
        });

        // Handle stream updates
        remoteStream.getTracks().forEach((track) => {
          track.onended = () => {
            console.log('Track ended for', userId);
          };

          track.onmute = () => {
            console.log('Track muted for', userId);
          };

          track.onunmute = () => {
            console.log('Track unmuted for', userId);
          };
        });
      };

      // Handle ICE candidates with buffering
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('ice-candidate', {
            candidate: event.candidate,
            to: userId,
          });
        } else if (event.candidate === null) {
          console.log('✅ ICE gathering complete for', userId);
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log(`🔗 Connection state with ${userId}:`, state);

        if (state === 'failed' || state === 'disconnected') {
          console.warn(`Connection ${state} with ${userId}, attempting to restart...`);
          // Attempt ICE restart
          const peer = peersRef.current.get(userId);
          if (peer && peer.connection.signalingState === 'stable') {
            peer.connection.restartIce();
          }
        } else if (state === 'closed') {
          setPeers((prev) => {
            const newPeers = new Map(prev);
            newPeers.delete(userId);
            return newPeers;
          });
          peersRef.current.delete(userId);
        }
      };

      // Handle ICE connection state
      peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log(`🧊 ICE connection state with ${userId}:`, state);

        if (state === 'failed') {
          console.warn(`ICE connection failed with ${userId}, restarting...`);
          peerConnection.restartIce();
        }
      };

      // Handle ICE gathering state
      peerConnection.onicegatheringstatechange = () => {
        console.log(`🧊 ICE gathering state with ${userId}:`, peerConnection.iceGatheringState);
      };

      // Store peer connection
      const newPeer: PeerConnection = {
        userId,
        connection: peerConnection,
        iceCandidates: [],
        remoteDescriptionSet: false,
      };

      peersRef.current.set(userId, newPeer);
      setPeers(new Map(peersRef.current));

      return peerConnection;
    },
    []
  );

  // Add buffered ICE candidates
  const addBufferedIceCandidates = useCallback(async (peer: PeerConnection) => {
    if (peer.iceCandidates.length > 0 && peer.remoteDescriptionSet) {
      console.log(`Adding ${peer.iceCandidates.length} buffered ICE candidates for ${peer.userId}`);
      for (const candidate of peer.iceCandidates) {
        try {
          await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding buffered ICE candidate:', error);
        }
      }
      peer.iceCandidates = [];
    }
  }, []);

  // Socket event handlers
  useEffect(() => {
    if (!socket || !localStreamRef.current) return;

    // Handle existing users in room
    const handleRoomUsers = async ({ users }: { users: string[] }) => {
      console.log('👥 Existing users in room:', users);

      for (const userId of users) {
        if (peersRef.current.has(userId)) {
          console.log(`Peer connection already exists for ${userId}`);
          continue;
        }

        const peerConnection = createPeerConnection(userId);

        // Create and send offer
        try {
          const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });

          await peerConnection.setLocalDescription(offer);
          socket.emit('offer', { offer, to: userId });
          console.log('📤 Sent offer to', userId);
        } catch (error) {
          console.error('Error creating/sending offer:', error);
        }
      }
    };

    // Handle new user joining
    const handleUserJoined = ({ userId }: { userId: string }) => {
      console.log('👋 User joined:', userId);

      if (peersRef.current.has(userId)) {
        console.log(`Peer connection already exists for ${userId}`);
        return;
      }

      createPeerConnection(userId);
    };

    // Handle offer
    const handleOffer = async ({
      offer,
      from,
    }: {
      offer: RTCSessionDescriptionInit;
      from: string;
    }) => {
      console.log('📥 Received offer from:', from);

      let peer = peersRef.current.get(from);

      if (!peer) {
        peer = {
          userId: from,
          connection: createPeerConnection(from),
          iceCandidates: [],
          remoteDescriptionSet: false,
        };
      }

      try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
        peer.remoteDescriptionSet = true;

        // Add any buffered ICE candidates
        await addBufferedIceCandidates(peer);

        const answer = await peer.connection.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });

        await peer.connection.setLocalDescription(answer);
        socket.emit('answer', { answer, to: from });
        console.log('📤 Sent answer to', from);
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    };

    // Handle answer
    const handleAnswer = async ({
      answer,
      from,
    }: {
      answer: RTCSessionDescriptionInit;
      from: string;
    }) => {
      console.log('📥 Received answer from:', from);

      const peer = peersRef.current.get(from);
      if (peer) {
        try {
          await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
          peer.remoteDescriptionSet = true;

          // Add any buffered ICE candidates
          await addBufferedIceCandidates(peer);
        } catch (error) {
          console.error('Error handling answer:', error);
        }
      }
    };

    // Handle ICE candidate
    const handleIceCandidate = async ({
      candidate,
      from,
    }: {
      candidate: RTCIceCandidateInit;
      from: string;
    }) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        // Buffer candidates if remote description not set yet
        if (!peer.remoteDescriptionSet) {
          console.log(`Buffering ICE candidate from ${from} (remote description not set yet)`);
          peer.iceCandidates.push(candidate);
          return;
        }

        try {
          await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    };

    // Handle user leaving
    const handleUserLeft = ({ userId }: { userId: string }) => {
      console.log('👋 User left:', userId);

      const peer = peersRef.current.get(userId);
      if (peer) {
        try {
          peer.connection.close();
        } catch (error) {
          console.error('Error closing peer connection:', error);
        }
        peersRef.current.delete(userId);
        setPeers(new Map(peersRef.current));
      }
    };

    socket.on('room-users', handleRoomUsers);
    socket.on('user-joined', handleUserJoined);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('user-left', handleUserLeft);

    return () => {
      socket.off('room-users', handleRoomUsers);
      socket.off('user-joined', handleUserJoined);
      socket.off('offer', handleOffer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('user-left', handleUserLeft);
    };
  }, [socket, createPeerConnection, addBufferedIceCandidates]);

  // Join room when socket and local stream are ready
  useEffect(() => {
    if (socket && localStreamRef.current && isConnected && !hasJoinedRoom) {
      console.log('🚪 Joining room:', roomId);
      socket.emit('join-room', { roomId });
      setHasJoinedRoom(true);
    }
  }, [socket, isConnected, roomId, hasJoinedRoom]);

  // Toggle audio with proper state management
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);

        // Update tracks in all peer connections
        peersRef.current.forEach((peer) => {
          const sender = peer.connection.getSenders().find((s) =>
            s.track?.kind === 'audio'
          );
          if (sender && audioTrack) {
            sender.replaceTrack(audioTrack);
          }
        });
      }
    }
  }, []);

  // Toggle video with proper state management
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);

        // Update tracks in all peer connections
        peersRef.current.forEach((peer) => {
          const sender = peer.connection.getSenders().find((s) =>
            s.track?.kind === 'video'
          );
          if (sender && videoTrack) {
            sender.replaceTrack(videoTrack);
          }
        });
      }
    }
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ margin: 0 }}>Video Call - Room: {roomId}</h1>
          
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '8px 16px',
                borderRadius: '20px',
                backgroundColor: isConnected ? '#4CAF50' : '#f44336',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '14px',
              }}
            >
              {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
            </span>
            
            {connectionError && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  backgroundColor: '#ff9800',
                  color: 'white',
                  fontSize: '12px',
                }}
              >
                ⚠️ {connectionError}
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '15px',
            marginBottom: '20px',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={toggleAudio}
            disabled={!localStream}
            style={{
              padding: '12px 24px',
              backgroundColor: isAudioEnabled ? '#4CAF50' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: localStream ? 'pointer' : 'not-allowed',
              fontSize: '16px',
              fontWeight: 'bold',
              opacity: localStream ? 1 : 0.6,
              transition: 'all 0.3s ease',
            }}
            onMouseOver={(e) => {
              if (localStream) {
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {isAudioEnabled ? '🎤 Mute' : '🔇 Unmute'}
          </button>

          <button
            onClick={toggleVideo}
            disabled={!localStream}
            style={{
              padding: '12px 24px',
              backgroundColor: isVideoEnabled ? '#4CAF50' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: localStream ? 'pointer' : 'not-allowed',
              fontSize: '16px',
              fontWeight: 'bold',
              opacity: localStream ? 1 : 0.6,
              transition: 'all 0.3s ease',
            }}
            onMouseOver={(e) => {
              if (localStream) {
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {isVideoEnabled ? '📹 Stop Video' : '📷 Start Video'}
          </button>

          <div style={{ marginLeft: 'auto', color: '#666', fontSize: '14px', alignSelf: 'center' }}>
            {peers.size > 0 && (
              <span>👥 {peers.size} participant{peers.size !== 1 ? 's' : ''} in call</span>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '20px',
          }}
        >
          {/* Local Video */}
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '15px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '10px', color: '#333' }}>
              You {isVideoEnabled ? '' : '(Camera Off)'}
            </h3>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                maxWidth: '500px',
                backgroundColor: '#000',
                borderRadius: '8px',
                aspectRatio: '16/9',
              }}
            />
            {!isVideoEnabled && (
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: 'white',
                  fontSize: '48px',
                }}
              >
                📷
              </div>
            )}
          </div>

          {/* Remote Videos */}
          {Array.from(peers.values()).map((peer) => (
            <RemoteVideo key={peer.userId} peer={peer} />
          ))}
        </div>

        {peers.size === 0 && localStream && isConnected && (
          <div
            style={{
              textAlign: 'center',
              padding: '40px',
              backgroundColor: 'white',
              borderRadius: '12px',
              marginTop: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <p style={{ margin: 0, color: '#666', fontSize: '16px' }}>
              👀 Waiting for others to join the call...
            </p>
            <p style={{ margin: '10px 0 0 0', color: '#999', fontSize: '14px' }}>
              Share the room ID: <strong>{roomId}</strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RemoteVideo({ peer }: { peer: PeerConnection }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('');

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
      const videoTrack = peer.stream.getVideoTracks()[0];
      setHasVideo(videoTrack?.readyState === 'live');

      // Monitor track state
      const updateVideoState = () => {
        setHasVideo(videoTrack?.readyState === 'live' || false);
      };

      videoTrack?.addEventListener('ended', updateVideoState);
      videoTrack?.addEventListener('mute', updateVideoState);
      videoTrack?.addEventListener('unmute', updateVideoState);

      return () => {
        videoTrack?.removeEventListener('ended', updateVideoState);
        videoTrack?.removeEventListener('mute', updateVideoState);
        videoTrack?.removeEventListener('unmute', updateVideoState);
      };
    }
  }, [peer.stream]);

  useEffect(() => {
    const updateConnectionState = () => {
      setConnectionState(peer.connection.connectionState);
    };

    peer.connection.addEventListener('connectionstatechange', updateConnectionState);
    updateConnectionState();

    return () => {
      peer.connection.removeEventListener('connectionstatechange', updateConnectionState);
    };
  }, [peer.connection]);

  const getStateColor = (state: string) => {
    switch (state) {
      case 'connected':
        return '#4CAF50';
      case 'connecting':
        return '#ff9800';
      case 'disconnected':
        return '#ff9800';
      case 'failed':
        return '#f44336';
      default:
        return '#9e9e9e';
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '15px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>
          Participant {!hasVideo && '(Camera Off)'}
        </h3>
        {connectionState && (
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              backgroundColor: getStateColor(connectionState),
              color: 'white',
              fontSize: '10px',
              textTransform: 'uppercase',
            }}
          >
            {connectionState}
          </span>
        )}
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: '100%',
          maxWidth: '500px',
          backgroundColor: '#000',
          borderRadius: '8px',
          aspectRatio: '16/9',
        }}
      />
      {!hasVideo && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            fontSize: '48px',
            pointerEvents: 'none',
          }}
        >
          📷
        </div>
      )}
    </div>
  );
}