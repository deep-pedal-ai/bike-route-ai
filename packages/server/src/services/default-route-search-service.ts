import { createPgRouteSearchDbClient } from '../clients/db-client.js';
import { createOpenAIRouteSearchClient } from '../clients/openai-client.js';
import { createRouteSearchService } from './route-search-service.js';

export function createDefaultRouteSearchService() {
  return createRouteSearchService(
    createOpenAIRouteSearchClient(),
    createPgRouteSearchDbClient(),
  );
}
