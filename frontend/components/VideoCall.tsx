"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface PeerConnection {
  userId: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function VideoCall({ roomId }: { roomId: string }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map());
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());

  // Initialize socket connection
  useEffect(() => {
    const socketInstance = io("http://localhost:3001");
    setSocket(socketInstance);

    socketInstance.on("connect", () => {
      console.log("Connected to signaling server");
      setIsConnected(true);
    });

    socketInstance.on("disconnect", () => {
      console.log("Disconnected from signaling server");
      setIsConnected(false);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  // Get local media stream
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        setLocalStream(stream);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error("Error accessing media devices:", error);
        alert("Could not access camera/microphone. Please check permissions.");
      }
    };

    getLocalStream();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Join room when socket and local stream are ready
  useEffect(() => {
    if (socket && localStream && isConnected) {
      socket.emit("join-room", { roomId });
    }
  }, [socket, localStream, isConnected, roomId]);

  // Create peer connection
  const createPeerConnection = (userId: string): RTCPeerConnection => {
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Add local stream tracks to peer connection
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
      console.log("Received remote track from", userId);
      const remoteStream = event.streams[0];

      setPeers((prev) => {
        const newPeers = new Map(prev);
        const peer = newPeers.get(userId);
        if (peer) {
          peer.stream = remoteStream;
          newPeers.set(userId, peer);
        }
        return newPeers;
      });
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("ice-candidate", {
          candidate: event.candidate,
          to: userId,
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(
        `Connection state with ${userId}:`,
        peerConnection.connectionState
      );
    };

    return peerConnection;
  };

  // Socket event handlers
  useEffect(() => {
    if (!socket || !localStream) return;

    // Handle existing users in room
    socket.on("room-users", async ({ users }: { users: string[] }) => {
      console.log("Existing users in room:", users);

      for (const userId of users) {
        const peerConnection = createPeerConnection(userId);

        const newPeer: PeerConnection = {
          userId,
          connection: peerConnection,
        };

        peersRef.current.set(userId, newPeer);
        setPeers(new Map(peersRef.current));

        // Create and send offer
        try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit("offer", { offer, to: userId });
        } catch (error) {
          console.error("Error creating offer:", error);
        }
      }
    });

    // Handle new user joining
    socket.on("user-joined", ({ userId }: { userId: string }) => {
      console.log("User joined:", userId);

      const peerConnection = createPeerConnection(userId);

      const newPeer: PeerConnection = {
        userId,
        connection: peerConnection,
      };

      peersRef.current.set(userId, newPeer);
      setPeers(new Map(peersRef.current));
    });

    // Handle offer
    socket.on(
      "offer",
      async ({
        offer,
        from,
      }: {
        offer: RTCSessionDescriptionInit;
        from: string;
      }) => {
        console.log("Received offer from:", from);

        let peer = peersRef.current.get(from);

        if (!peer) {
          const peerConnection = createPeerConnection(from);
          peer = {
            userId: from,
            connection: peerConnection,
          };
          peersRef.current.set(from, peer);
          setPeers(new Map(peersRef.current));
        }

        try {
          await peer.connection.setRemoteDescription(
            new RTCSessionDescription(offer)
          );
          const answer = await peer.connection.createAnswer();
          await peer.connection.setLocalDescription(answer);
          socket.emit("answer", { answer, to: from });
        } catch (error) {
          console.error("Error handling offer:", error);
        }
      }
    );

    // Handle answer
    socket.on(
      "answer",
      async ({
        answer,
        from,
      }: {
        answer: RTCSessionDescriptionInit;
        from: string;
      }) => {
        console.log("Received answer from:", from);

        const peer = peersRef.current.get(from);
        if (peer) {
          try {
            await peer.connection.setRemoteDescription(
              new RTCSessionDescription(answer)
            );
          } catch (error) {
            console.error("Error handling answer:", error);
          }
        }
      }
    );

    // Handle ICE candidate
    socket.on(
      "ice-candidate",
      async ({
        candidate,
        from,
      }: {
        candidate: RTCIceCandidateInit;
        from: string;
      }) => {
        const peer = peersRef.current.get(from);
        if (peer) {
          try {
            await peer.connection.addIceCandidate(
              new RTCIceCandidate(candidate)
            );
          } catch (error) {
            console.error("Error adding ICE candidate:", error);
          }
        }
      }
    );

    // Handle user leaving
    socket.on("user-left", ({ userId }: { userId: string }) => {
      console.log("User left:", userId);

      const peer = peersRef.current.get(userId);
      if (peer) {
        peer.connection.close();
        peersRef.current.delete(userId);
        setPeers(new Map(peersRef.current));
      }
    });

    return () => {
      socket.off("room-users");
      socket.off("user-joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("user-left");
    };
  }, [socket, localStream]);

  // Toggle audio
  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>Video Call - Room: {roomId}</h1>

      <div style={{ marginBottom: "20px" }}>
        <span
          style={{
            display: "inline-block",
            padding: "5px 10px",
            borderRadius: "5px",
            backgroundColor: isConnected ? "#4CAF50" : "#f44336",
            color: "white",
          }}
        >
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={toggleAudio}
          style={{
            padding: "10px 20px",
            marginRight: "10px",
            backgroundColor: isAudioEnabled ? "#4CAF50" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          {isAudioEnabled ? "🎤 Mute" : "🔇 Unmute"}
        </button>

        <button
          onClick={toggleVideo}
          style={{
            padding: "10px 20px",
            backgroundColor: isVideoEnabled ? "#4CAF50" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          {isVideoEnabled ? "📹 Stop Video" : "📷 Start Video"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "20px",
        }}
      >
        {/* Local Video */}
        <div>
          <h3>You (Local)</h3>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              maxWidth: "500px",
              backgroundColor: "#000",
              borderRadius: "10px",
            }}
          />
        </div>

        {/* Remote Videos */}
        {Array.from(peers.values()).map((peer) => (
          <RemoteVideo key={peer.userId} peer={peer} />
        ))}
      </div>

      {peers.size === 0 && localStream && (
        <p style={{ marginTop: "20px", color: "#666" }}>
          Waiting for others to join the call...
        </p>
      )}
    </div>
  );
}

function RemoteVideo({ peer }: { peer: PeerConnection }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div>
      <h3>Participant</h3>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: "100%",
          maxWidth: "500px",
          backgroundColor: "#000",
          borderRadius: "10px",
        }}
      />
    </div>
  );
}
