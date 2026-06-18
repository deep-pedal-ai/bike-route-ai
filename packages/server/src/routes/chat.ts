import { Router } from 'express';

import { createChatController } from '../controllers/chat-controller.js';
import { createOpenAIChatService } from '../clients/openai-chat-client.js';
import type { ChatService } from '../services/chat-types.js';

type ChatRouterDependencies = {
  chatService?: ChatService;
};

export function createChatRouter(dependencies: ChatRouterDependencies = {}) {
  const router = Router();
  const chatController = createChatController(
    dependencies.chatService ?? createOpenAIChatService(),
  );

  router.post('/', chatController.stream);

  return router;
}

export const chatRouter = createChatRouter();
