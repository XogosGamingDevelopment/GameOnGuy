import Link from "next/link";
import {
  ArrowLeft,
  Server,
  Box,
  MessageSquare,
  FileCode,
  Copy,
  ChevronRight,
} from "lucide-react";

const apiSections = [
  {
    id: "server",
    title: "Server API",
    description: "Core server class methods and configuration",
    endpoints: [
      {
        name: "GameOnServer",
        type: "class",
        description: "Main server class that handles WebSocket connections and room management.",
        signature: "new GameOnServer(config: ServerConfig)",
        example: `import { GameOnServer } from '@gameon/multiplayer-server';

const server = new GameOnServer({
  port: 3000,
  redis: {
    host: 'localhost',
    port: 6379
  },
  database: {
    connectionString: process.env.DATABASE_URL
  }
});

server.start();`,
      },
      {
        name: "server.defineRoom",
        type: "method",
        description: "Register a room type that clients can create or join.",
        signature: "defineRoom<T extends Room>(name: string, roomClass: new () => T): void",
        example: `server.defineRoom('trivia', TriviaRoom);
server.defineRoom('battle', BattleRoom);`,
      },
      {
        name: "server.onAuth",
        type: "method",
        description: "Set a custom authentication handler for incoming connections.",
        signature: "onAuth(handler: (token: string) => Promise<AuthResult>): void",
        example: `server.onAuth(async (token) => {
  const user = await verifyToken(token);
  return { userId: user.id, username: user.name };
});`,
      },
      {
        name: "server.gracefulShutdown",
        type: "method",
        description: "Gracefully shut down the server, waiting for rooms to empty.",
        signature: "gracefulShutdown(timeout?: number): Promise<void>",
        example: `process.on('SIGTERM', async () => {
  await server.gracefulShutdown(30000);
  process.exit(0);
});`,
      },
    ],
  },
  {
    id: "room",
    title: "Room API",
    description: "Base room class for creating game rooms",
    endpoints: [
      {
        name: "Room",
        type: "class",
        description: "Base class for all game rooms. Extend this to create custom game logic.",
        signature: "abstract class Room<TState, TClient>",
        example: `import { Room, Client } from '@gameon/multiplayer-server';

interface GameState {
  players: Map<string, Player>;
  phase: 'waiting' | 'playing' | 'ended';
}

class MyGameRoom extends Room<GameState> {
  onCreate(options: RoomOptions) {
    this.setState({
      players: new Map(),
      phase: 'waiting'
    });
  }
}`,
      },
      {
        name: "room.onCreate",
        type: "lifecycle",
        description: "Called when the room is created. Initialize your game state here.",
        signature: "onCreate(options: RoomOptions): void | Promise<void>",
        example: `onCreate(options) {
  this.maxClients = options.maxPlayers || 4;
  this.setState({ round: 0, scores: {} });
  this.setMetadata({ gameMode: options.mode });
}`,
      },
      {
        name: "room.onJoin",
        type: "lifecycle",
        description: "Called when a client joins the room.",
        signature: "onJoin(client: Client, options: JoinOptions): void | Promise<void>",
        example: `onJoin(client, options) {
  this.state.players.set(client.sessionId, {
    name: options.username,
    score: 0,
    ready: false
  });
  this.broadcast('player_joined', { id: client.sessionId });
}`,
      },
      {
        name: "room.onLeave",
        type: "lifecycle",
        description: "Called when a client leaves the room.",
        signature: "onLeave(client: Client, consented: boolean): void | Promise<void>",
        example: `async onLeave(client, consented) {
  if (!consented) {
    // Allow reconnection for 30 seconds
    const reconnected = await this.allowReconnection(client, 30);
    if (reconnected) return;
  }
  this.state.players.delete(client.sessionId);
}`,
      },
      {
        name: "room.onMessage",
        type: "method",
        description: "Register a handler for a specific message type.",
        signature: "onMessage<T>(type: string, handler: (client: Client, message: T) => void): void",
        example: `onCreate() {
  this.onMessage('move', (client, data) => {
    const player = this.state.players.get(client.sessionId);
    player.x = data.x;
    player.y = data.y;
  });

  this.onMessage('chat', (client, message) => {
    this.broadcast('chat', {
      from: client.sessionId,
      text: message.text
    });
  });
}`,
      },
      {
        name: "room.broadcast",
        type: "method",
        description: "Send a message to all connected clients.",
        signature: "broadcast(type: string, message: any, options?: BroadcastOptions): void",
        example: `// Send to all clients
this.broadcast('game_start', { countdown: 3 });

// Send to all except one client
this.broadcast('player_moved', data, {
  except: client
});`,
      },
      {
        name: "room.send",
        type: "method",
        description: "Send a message to a specific client.",
        signature: "send(client: Client, type: string, message: any): void",
        example: `// Send private message to one client
this.send(client, 'your_cards', {
  cards: player.hand
});`,
      },
    ],
  },
  {
    id: "messages",
    title: "Client Messages",
    description: "Built-in message types and protocols",
    endpoints: [
      {
        name: "State Sync",
        type: "protocol",
        description: "Automatic state synchronization between server and clients.",
        signature: "Message type: 'state_sync'",
        example: `// Server-side: State changes are automatically synced
this.state.scores[playerId] = 100;

// Client-side (Unity): Listen for state changes
room.OnStateChange += (state) => {
  UpdateScoreboard(state.scores);
};`,
      },
      {
        name: "Room Events",
        type: "protocol",
        description: "Built-in room lifecycle events.",
        signature: "join, leave, error, reconnect",
        example: `// Unity client
room.OnJoin += () => Debug.Log("Joined room!");
room.OnLeave += (code) => Debug.Log($"Left: {code}");
room.OnError += (error) => Debug.LogError(error);`,
      },
      {
        name: "Custom Messages",
        type: "protocol",
        description: "Send and receive custom message types.",
        signature: "room.Send(type, data) / room.OnMessage(type, handler)",
        example: `// Unity client: Send a message
room.Send("player_action", new {
  action = "jump",
  position = transform.position
});

// Unity client: Receive messages
room.OnMessage<ChatMessage>("chat", (message) => {
  chatUI.AddMessage(message.from, message.text);
});`,
      },
    ],
  },
  {
    id: "types",
    title: "TypeScript Types",
    description: "Core type definitions",
    endpoints: [
      {
        name: "ServerConfig",
        type: "interface",
        description: "Configuration options for the server.",
        signature: "interface ServerConfig",
        example: `interface ServerConfig {
  port: number;
  redis?: {
    host: string;
    port: number;
    password?: string;
  };
  database?: {
    connectionString: string;
  };
  cors?: {
    origin: string | string[];
  };
  gracefulShutdownTimeout?: number;
}`,
      },
      {
        name: "Client",
        type: "interface",
        description: "Represents a connected client.",
        signature: "interface Client",
        example: `interface Client {
  sessionId: string;
  auth: AuthData;
  send(type: string, message: any): void;
  leave(code?: number): void;
  error(message: string): void;
}`,
      },
      {
        name: "RoomOptions",
        type: "interface",
        description: "Options passed when creating a room.",
        signature: "interface RoomOptions",
        example: `interface RoomOptions {
  maxClients?: number;
  metadata?: Record<string, any>;
  [key: string]: any;
}`,
      },
      {
        name: "JoinOptions",
        type: "interface",
        description: "Options passed when a client joins a room.",
        signature: "interface JoinOptions",
        example: `interface JoinOptions {
  username?: string;
  team?: string;
  [key: string]: any;
}`,
      },
    ],
  },
];

function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 overflow-x-auto text-sm">
        <code className="text-slate-300">{code}</code>
      </pre>
      <button
        className="absolute top-2 right-2 p-2 rounded-md bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy code"
      >
        <Copy className="h-4 w-4 text-slate-400" />
      </button>
    </div>
  );
}

export default function APIReferencePage() {
  return (
    <div className="pt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col lg:flex-row gap-12">
          {/* Sidebar */}
          <aside className="lg:w-64 flex-shrink-0">
            <div className="sticky top-24">
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-6"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Docs
              </Link>

              <nav className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  API Reference
                </p>
                {apiSections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                  >
                    {section.id === "server" && <Server className="h-4 w-4" />}
                    {section.id === "room" && <Box className="h-4 w-4" />}
                    {section.id === "messages" && <MessageSquare className="h-4 w-4" />}
                    {section.id === "types" && <FileCode className="h-4 w-4" />}
                    {section.title}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <div className="mb-12">
              <h1 className="text-4xl font-bold text-white mb-4">API Reference</h1>
              <p className="text-xl text-slate-400">
                Complete reference documentation for the Game On Dude! server SDK.
              </p>
            </div>

            <div className="space-y-16">
              {apiSections.map((section) => (
                <section key={section.id} id={section.id}>
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold text-white mb-2">{section.title}</h2>
                    <p className="text-slate-400">{section.description}</p>
                  </div>

                  <div className="space-y-8">
                    {section.endpoints.map((endpoint, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl bg-slate-800/30 border border-slate-700 overflow-hidden"
                      >
                        <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-lg font-mono font-semibold text-white">
                              {endpoint.name}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                endpoint.type === "class"
                                  ? "bg-violet-500/20 text-violet-400"
                                  : endpoint.type === "method"
                                  ? "bg-blue-500/20 text-blue-400"
                                  : endpoint.type === "lifecycle"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : endpoint.type === "protocol"
                                  ? "bg-yellow-500/20 text-yellow-400"
                                  : "bg-slate-500/20 text-slate-400"
                              }`}
                            >
                              {endpoint.type}
                            </span>
                          </div>
                          <p className="text-slate-400 text-sm">{endpoint.description}</p>
                        </div>

                        <div className="px-6 py-4 space-y-4">
                          <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              Signature
                            </p>
                            <code className="text-sm text-violet-400 font-mono">
                              {endpoint.signature}
                            </code>
                          </div>

                          <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              Example
                            </p>
                            <CodeBlock code={endpoint.example} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Next Steps */}
            <div className="mt-16 p-8 rounded-xl bg-gradient-to-r from-violet-900/20 to-fuchsia-900/20 border border-violet-500/20">
              <h3 className="text-xl font-semibold text-white mb-4">Need More Help?</h3>
              <p className="text-slate-400 mb-6">
                Check out our guides for step-by-step tutorials on building multiplayer games.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/docs/getting-started"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300"
                >
                  Quick Start Guide
                  <ChevronRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/docs/unity-sdk"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300"
                >
                  Unity SDK
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
