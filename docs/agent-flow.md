# ReAct Agent Flow

How a chat turn travels from the browser through the LangGraph ReAct agent and
back. Source of truth:

- Client: `packages/client/src/hooks/use-plan-chat.ts`, `src/api/chat.ts`
- Server HTTP/SSE: `packages/server/src/routes/chat.ts`, `controllers/chat-controller.ts`
- Agent: `packages/server/src/clients/openai-chat-client.ts`
- Tools: `packages/server/src/clients/magiclane-mcp-client.ts`
- Wire contract: `packages/shared/src/index.ts` (`ChatRequest`, `ChatStreamEvent`)

## Component view

```mermaid
flowchart TB
  subgraph Client["packages/client (React)"]
    Hook["usePlanChat hook<br/>holds messages + stable conversationId"]
    StreamChat["streamChat()<br/>api/chat.ts — POST + SSE parse"]
    Hook -->|"ask(query)"| StreamChat
    StreamChat -->|"token → append text<br/>image → append image"| Hook
  end

  subgraph Server["packages/server (Express)"]
    Route["POST /api/chat<br/>routes/chat.ts"]
    Ctrl["chat-controller.stream<br/>validate, SSE framing,<br/>abort handling"]
    Route --> Ctrl

    subgraph Agent["createOpenAIChatService — LangGraph ReAct agent"]
      React["createReactAgent<br/>(reason ↔ act loop)"]
      Mem["MemorySaver checkpointer<br/>keyed by thread_id = conversationId"]
      React <--> Mem
    end
    Ctrl -->|"streamReply(query, conversationId)"| React
    React -->|"AIMessageChunk → token<br/>ToolMessage image_url → image"| Ctrl
  end

  subgraph External["External services"]
    LLM["OpenAI Chat<br/>ChatOpenAI streaming"]
    MCP["Magic Lane MCP server<br/>http (URL) or stdio (npx)"]
  end

  React <-->|"reason / next action"| LLM
  React -->|"tool calls"| Tools

  subgraph Tools["loadMagicLaneTools()"]
    Generic["Generic MCP tools:<br/>round_trip · route_planner · location_search"]
    Raw["Hand-built raw-client tools:<br/>render_round_trip_map · render_routing_map<br/>(static_map_render workaround)"]
  end
  Generic --> MCP
  Raw --> MCP

  StreamChat -->|"HTTP POST /api/chat<br/>{query, conversationId}"| Route
  Ctrl -->|"text/event-stream<br/>token · image · done · error"| StreamChat

  Empty["No MAGICLANE_API_KEY / URL →<br/>tools = [] → agent runs tool-less"]:::note
  Tools -.-> Empty
  classDef note fill:#fff3cd,stroke:#e0a800,color:#553;
```

## Turn sequence (the ReAct loop)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant H as usePlanChat / streamChat
  participant C as chat-controller
  participant A as ReAct agent
  participant L as OpenAI
  participant M as Magic Lane MCP

  U->>H: type query
  H->>C: POST /api/chat {query, conversationId}
  C->>C: validate (≤500 chars, non-empty)
  C->>A: streamReply(query, conversationId)
  A->>A: load thread state via MemorySaver (thread_id)

  loop ReAct: reason → act → observe
    A->>L: messages + tool schemas
    L-->>A: assistant tokens / tool call
    A-->>C: token chunks (AIMessageChunk)
    C-->>H: SSE event: token
    alt tool call requested
      A->>M: call tool (e.g. location_search, round_trip,<br/>render_round_trip_map)
      M-->>A: result (text and/or PNG image)
      A-->>C: image chunk (ToolMessage image_url)
      C-->>H: SSE event: image
    end
  end

  A-->>C: stream complete
  C-->>H: SSE event: done
  H-->>U: render final reply + map image(s)

  Note over C,H: mid-stream failure → SSE error event<br/>client abort (unmount/new ask) → controller stops pulling tokens
```

## Key behaviors

- **Memory threading** — `conversationId` is minted once per chat in the hook
  and sent on every turn; the server uses it as the LangGraph `thread_id` so
  follow-ups ("now add a stop in X") build on the route already planned.
- **Two chunk types stream back** — text `token`s from the model, and `image`s
  from tool results (rendered map PNGs arrive as `image_url` data-URL blocks).
- **Tool-less fallback** — with no Magic Lane config, `loadMagicLaneTools`
  returns `[]` and the agent still answers (text only); keeps dev/test running.
- **MCP transport is config-driven** — `MAGICLANE_MCP_URL` → HTTP to a running
  service; otherwise spawn `@magiclane/mcp-server` over stdio via `npx`.
- **`static_map_render` workaround** — its union input schema breaks client-side
  validation in `@langchain/mcp-adapters`, so the two render tools are
  hand-built against the raw MCP client with narrow Zod schemas.
