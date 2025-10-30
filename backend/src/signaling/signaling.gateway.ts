import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface Room {
  users: Set<string>;
}

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000',
    credentials: true,
  },
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private rooms: Map<string, Room> = new Map();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    
    // Remove user from all rooms
    this.rooms.forEach((room, roomId) => {
      if (room.users.has(client.id)) {
        room.users.delete(client.id);
        
        // Notify other users in the room
        room.users.forEach((userId) => {
          this.server.to(userId).emit('user-left', { userId: client.id });
        });
        
        // Delete room if empty
        if (room.users.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    });
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId } = data;
    
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { users: new Set() });
    }
    
    const room = this.rooms.get(roomId);
    
    // Notify existing users about new user
    room.users.forEach((userId) => {
      this.server.to(userId).emit('user-joined', { userId: client.id });
    });
    
    // Add user to room
    room.users.add(client.id);
    client.join(roomId);
    
    // Send existing users to the new user
    const existingUsers = Array.from(room.users).filter(id => id !== client.id);
    client.emit('room-users', { users: existingUsers });
    
    console.log(`User ${client.id} joined room ${roomId}`);
  }

  @SubscribeMessage('offer')
  handleOffer(
    @MessageBody() data: { offer: RTCSessionDescriptionInit; to: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.server.to(data.to).emit('offer', {
      offer: data.offer,
      from: client.id,
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: { answer: RTCSessionDescriptionInit; to: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.server.to(data.to).emit('answer', {
      answer: data.answer,
      from: client.id,
    });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @MessageBody() data: { candidate: RTCIceCandidateInit; to: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.server.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: client.id,
    });
  }
}

