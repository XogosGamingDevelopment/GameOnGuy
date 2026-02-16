import Link from "next/link";
import {
  ArrowLeft,
  Network,
  Box,
  RefreshCw,
  MessageSquare,
  ChevronRight,
  Layers,
  Database,
  Zap,
  Users,
  ArrowLeftRight,
} from "lucide-react";

const concepts = [
  {
    id: "architecture",
    title: "Server Architecture",
    icon: Network,
    description: "How Game On Dude! is structured and how components interact.",
    content: `
Game On Dude! follows a **room-based architecture** where the server manages multiple isolated game rooms, each with its own state and connected clients.

### Core Components

1. **WebSocket Server** - Handles persistent connections with clients
2. **Room Manager** - Creates, destroys, and routes clients to rooms
3. **State Manager** - Synchronizes game state between server and clients
4. **Redis Adapter** - Enables horizontal scaling across multiple server instances
5. **Database Layer** - PostgreSQL for persistent data (players, scores, history)

### Request Flow

\`\`\`
Client → WebSocket → Server → Room Manager → Room Instance → State Manager → All Clients
\`\`\`

When a client sends a message:
1. WebSocket server receives the raw message
2. Message is decoded and authenticated
3. Room manager routes to the correct room
4. Room instance processes the game logic
5. State changes are broadcast to all clients in the room
`,
    diagram: `
┌─────────────────────────────────────────────────────────────────┐
│                        GameOn Server                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │   Client 1  │   │   Client 2  │   │   Client 3  │           │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘           │
│         │                 │                 │                   │
│         └────────────────┬┴─────────────────┘                   │
│                          │                                      │
│                  ┌───────▼───────┐                              │
│                  │  WebSocket    │                              │
│                  │    Server     │                              │
│                  └───────┬───────┘                              │
│                          │                                      │
│                  ┌───────▼───────┐                              │
│                  │ Room Manager  │                              │
│                  └───────┬───────┘                              │
│           ┌──────────────┼──────────────┐                       │
│           │              │              │                       │
│    ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐               │
│    │  Room A     │ │  Room B   │ │   Room C    │               │
│    │  (Trivia)   │ │ (Battle)  │ │   (Lobby)   │               │
│    └─────────────┘ └───────────┘ └─────────────┘               │
└─────────────────────────────────────────────────────────────────┘
`,
  },
  {
    id: "rooms",
    title: "Rooms & Matchmaking",
    icon: Box,
    description: "Understanding game rooms and how players are matched together.",
    content: `
### What is a Room?

A **Room** is an isolated game session where a group of players interact. Each room has:
- Unique ID
- Game state
- Connected clients
- Message handlers
- Lifecycle hooks

### Room Lifecycle

\`\`\`typescript
onCreate()   → Room is created, initialize state
onJoin()     → Client joins, add to player list
onMessage()  → Handle game actions
onLeave()    → Client leaves, cleanup
onDispose()  → Room is empty, cleanup resources
\`\`\`

### Matchmaking Strategies

**1. Join or Create**
\`\`\`typescript
// Client joins existing room or creates new one
await client.joinOrCreate("trivia", { difficulty: "hard" });
\`\`\`

**2. Join by ID**
\`\`\`typescript
// Client joins specific room
await client.joinById("abc123");
\`\`\`

**3. Create Private**
\`\`\`typescript
// Create room with a code for friends
const room = await client.create("trivia", { private: true });
// Share room.id with friends
\`\`\`

**4. Custom Matchmaking**
\`\`\`typescript
// Filter by metadata
await client.join("battle", {
  filter: {
    skillLevel: { $gte: 1000, $lte: 1500 }
  }
});
\`\`\`
`,
    diagram: null,
  },
  {
    id: "state-sync",
    title: "State Synchronization",
    icon: RefreshCw,
    description: "How game state is kept in sync between server and clients.",
    content: `
### Automatic State Sync

GameOn automatically synchronizes your room's state object to all connected clients. When you modify state on the server, changes are detected and broadcast.

\`\`\`typescript
// Server: Modify state
this.state.players.get(client.id).score += 100;
// Changes are automatically sent to all clients

// Client (Unity): Listen for changes
room.OnStateChange += (state) => {
    UpdateScoreboard(state.players);
};
\`\`\`

### Delta Compression

Only **changed properties** are sent over the network, not the entire state. This dramatically reduces bandwidth usage.

\`\`\`
Full State:     { players: [...100 players...], round: 5, timer: 30 }
Delta Update:   { round: 6 }  // Only 10 bytes!
\`\`\`

### Interpolation

Client-side interpolation smooths movement between state updates:

\`\`\`typescript
// Server sends position 20 times/second
// Client interpolates between positions for 60fps rendering
\`\`\`

### State Schema Types

| Type | Description | Use Case |
|------|-------------|----------|
| Primitive | string, number, boolean | Simple values |
| Map | Key-value collection | Player lists |
| Array | Ordered collection | Leaderboards |
| Nested | Objects within objects | Complex entities |
`,
    diagram: `
┌─────────────────────────────────────────────────────────┐
│                    State Sync Flow                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Server                           Clients              │
│   ┌─────────┐                                          │
│   │  State  │  ──── Full State ────►  Initial Join     │
│   │ Object  │                                          │
│   └────┬────┘                                          │
│        │                                                │
│   [ Mutation ]                                          │
│        │                                                │
│   ┌────▼────┐                                          │
│   │  Delta  │  ──── Patch Only ────►  State Update     │
│   │ Encoder │         (10 bytes)                       │
│   └─────────┘                                          │
│                                                         │
│   20 updates/sec ═══════════════► Interpolation        │
│                                    renders at 60fps     │
└─────────────────────────────────────────────────────────┘
`,
  },
  {
    id: "protocol",
    title: "Message Protocol",
    icon: MessageSquare,
    description: "The communication protocol between server and clients.",
    content: `
### Message Types

GameOn uses a binary protocol for efficient message encoding.

**System Messages** (handled automatically):
- \`join\` - Client joining room
- \`leave\` - Client leaving room
- \`state\` - Full state sync
- \`patch\` - Delta state update
- \`error\` - Error notification

**Custom Messages** (defined by you):
\`\`\`typescript
// Server: Define handler
this.onMessage("player_action", (client, data) => {
  // Process action
});

// Client: Send message
room.Send("player_action", new { type = "jump", power = 0.8f });
\`\`\`

### Message Structure

\`\`\`
┌────────┬──────────┬─────────────┐
│ Type   │ Length   │ Payload     │
│ 1 byte │ 2 bytes  │ N bytes     │
└────────┴──────────┴─────────────┘
\`\`\`

### Reliability

| Mode | Use Case | Example |
|------|----------|---------|
| Reliable | Important events | Score updates, game start |
| Unreliable | Frequent updates | Position updates |

\`\`\`typescript
// Reliable (default) - guaranteed delivery
this.broadcast("game_over", { winner: "player1" });

// Unreliable - faster, may drop
this.broadcast("position", data, { reliable: false });
\`\`\`
`,
    diagram: null,
  },
];

const netcodeFeatures = [
  {
    title: "Client-Side Prediction",
    description: "Execute actions immediately on client, reconcile with server",
    icon: Zap,
    href: "/docs/netcode/prediction",
  },
  {
    title: "Lag Compensation",
    description: "Rewind server state to validate hit detection",
    icon: ArrowLeftRight,
    href: "/docs/netcode/lag-compensation",
  },
  {
    title: "Interpolation",
    description: "Smooth rendering between discrete network updates",
    icon: RefreshCw,
    href: "/docs/netcode/interpolation",
  },
];

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 overflow-x-auto text-sm">
      <code className="text-slate-300">{code}</code>
    </pre>
  );
}

export default function ConceptsPage() {
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
                  Core Concepts
                </p>
                {concepts.map((concept) => (
                  <a
                    key={concept.id}
                    href={`#${concept.id}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                  >
                    <concept.icon className="h-4 w-4" />
                    {concept.title}
                  </a>
                ))}

                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-6 mb-3">
                  Advanced
                </p>
                <a
                  href="#netcode"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Zap className="h-4 w-4" />
                  Netcode
                </a>
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <div className="mb-12">
              <h1 className="text-4xl font-bold text-white mb-4">Core Concepts</h1>
              <p className="text-xl text-slate-400">
                Understand the key concepts behind Game On Dude! architecture.
              </p>
            </div>

            {/* Concept Sections */}
            <div className="space-y-16">
              {concepts.map((concept) => (
                <section key={concept.id} id={concept.id}>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
                      <concept.icon className="h-6 w-6 text-violet-400" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white">{concept.title}</h2>
                      <p className="text-slate-400">{concept.description}</p>
                    </div>
                  </div>

                  {concept.diagram && (
                    <div className="mb-6">
                      <CodeBlock code={concept.diagram} />
                    </div>
                  )}

                  <div className="prose prose-invert prose-slate max-w-none">
                    <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-6 md:p-8">
                      {concept.content.split("\n\n").map((paragraph, idx) => {
                        if (paragraph.startsWith("###")) {
                          return (
                            <h3 key={idx} className="text-lg font-semibold text-white mt-6 mb-3 first:mt-0">
                              {paragraph.replace("### ", "")}
                            </h3>
                          );
                        }
                        if (paragraph.startsWith("```")) {
                          const code = paragraph.replace(/```\w*\n?/g, "").trim();
                          return (
                            <div key={idx} className="my-4">
                              <CodeBlock code={code} />
                            </div>
                          );
                        }
                        if (paragraph.startsWith("|")) {
                          const rows = paragraph.trim().split("\n");
                          const headers = rows[0].split("|").filter(Boolean).map(h => h.trim());
                          const data = rows.slice(2).map(row =>
                            row.split("|").filter(Boolean).map(cell => cell.trim())
                          );
                          return (
                            <div key={idx} className="my-4 overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-700">
                                    {headers.map((h, i) => (
                                      <th key={i} className="text-left px-4 py-2 text-slate-400 font-medium">
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {data.map((row, i) => (
                                    <tr key={i} className="border-b border-slate-700/50">
                                      {row.map((cell, j) => (
                                        <td key={j} className="px-4 py-2 text-slate-300">
                                          {cell}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        }
                        if (paragraph.startsWith("**")) {
                          return (
                            <p key={idx} className="text-slate-300 my-3">
                              {paragraph.split("**").map((part, i) =>
                                i % 2 === 1 ? <strong key={i} className="text-white">{part}</strong> : part
                              )}
                            </p>
                          );
                        }
                        if (paragraph.match(/^\d\./)) {
                          return (
                            <ol key={idx} className="list-decimal list-inside space-y-1 my-3 text-slate-300">
                              {paragraph.split("\n").map((item, i) => (
                                <li key={i}>{item.replace(/^\d\.\s*/, "")}</li>
                              ))}
                            </ol>
                          );
                        }
                        return (
                          <p key={idx} className="text-slate-300 my-3">
                            {paragraph}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                </section>
              ))}

              {/* Netcode Section */}
              <section id="netcode">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
                    <Zap className="h-6 w-6 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Netcode</h2>
                    <p className="text-slate-400">Advanced networking features for responsive gameplay</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-6">
                  {netcodeFeatures.map((feature) => (
                    <Link
                      key={feature.title}
                      href={feature.href}
                      className="group rounded-xl bg-slate-800/30 border border-slate-700 p-6 hover:border-violet-500/50 transition-all"
                    >
                      <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
                        <feature.icon className="h-5 w-5 text-violet-400" />
                      </div>
                      <h3 className="font-semibold text-white mb-2 group-hover:text-violet-400 transition-colors">
                        {feature.title}
                      </h3>
                      <p className="text-sm text-slate-400">{feature.description}</p>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            {/* Next Steps */}
            <div className="mt-16 p-8 rounded-xl bg-gradient-to-r from-violet-900/20 to-fuchsia-900/20 border border-violet-500/20">
              <h3 className="text-xl font-semibold text-white mb-4">Ready to Build?</h3>
              <p className="text-slate-400 mb-6">
                Now that you understand the concepts, start building your first multiplayer game.
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
                  href="/docs/api"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300"
                >
                  API Reference
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
