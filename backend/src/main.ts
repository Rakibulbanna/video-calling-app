import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: "http://10.81.100.85:3000",
      credentials: true,
    },
  });

  await app.listen(3001);
  console.log("🚀 Server is running on http://localhost:3001");
}

bootstrap();
