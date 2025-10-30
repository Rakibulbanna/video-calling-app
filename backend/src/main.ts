import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: 'http://localhost:3000',
      credentials: true,
    },
  });
  
  await app.listen(3001);
  console.log('🚀 Server is running on http://localhost:3001');
}

bootstrap();

