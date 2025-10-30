import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling/signaling.gateway';

@Module({
  imports: [],
  providers: [SignalingGateway],
})
export class AppModule {}

