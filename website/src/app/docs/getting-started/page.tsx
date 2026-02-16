import Link from "next/link";
import { ArrowRight, ArrowLeft, Terminal, Check, Copy, Download, Sparkles } from "lucide-react";

const steps = [
  {
    title: "Prerequisites",
    content: `Before you begin, make sure you have:
- **Node.js 18+** installed
- **npm** or **yarn** package manager
- **Git** for version control
- A code editor (VS Code recommended)`,
  },
  {
    title: "Clone the Repository",
    code: `git clone https://github.com/gameon-guy/multiplayer-server.git
cd multiplayer-server`,
  },
  {
    title: "Install Dependencies",
    code: `npm install`,
  },
  {
    title: "Build the Server",
    code: `npm run build`,
  },
  {
    title: "Start the Server",
    code: `npm start`,
    content: `You should see output like:

\`\`\`
[INFO] Starting Game On Dude! Server...
[INFO] Game type registered: lightning_round
[INFO] Game type registered: time_quest
[INFO] Game type registered: number_munchers
[INFO] Game type registered: panic_attack
[INFO] Game type registered: historical_conquest
[INFO] All game types registered
[INFO] Game On Dude! Server started (port: 3000)
\`\`\``,
  },
  {
    title: "Test the Connection",
    code: `curl http://localhost:3000/health`,
    content: `Should return: \`{"status":"ok","clients":0}\``,
  },
];

export default function GettingStartedPage() {
  return (
    <div className="pt-24">
      {/* Breadcrumb */}
      <div className="bg-slate-900/50 border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm">
            <Link href="/docs" className="text-slate-400 hover:text-white transition-colors">
              Docs
            </Link>
            <span className="text-slate-600">/</span>
            <span className="text-white">Getting Started</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid lg:grid-cols-[1fr_280px] gap-12">
          {/* Main Content */}
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold text-white mb-4">Getting Started</h1>
            <p className="text-xl text-slate-400 mb-8">
              Get Game On Dude! running locally in under 5 minutes.
            </p>

            {/* AI Integration Guide Download */}
            <div className="mb-12 p-6 rounded-xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/30">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="h-6 w-6 text-violet-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    AI-Powered Integration
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    Download our AI Integration Guide and upload it to your favorite AI code generator
                    (Claude Code, GitHub Copilot, Cursor, etc.) to get intelligent help integrating
                    your game with Game On Dude!. The guide includes complete code examples,
                    patterns, and API references.
                  </p>
                  <a
                    href="/gameon-multiplayer-ai-integration-guide.md"
                    download="gameon-multiplayer-ai-integration-guide.md"
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    Download AI Integration Guide
                  </a>
                </div>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-12">
              {steps.map((step, index) => (
                <div key={step.title} id={step.title.toLowerCase().replace(/\s+/g, "-")}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 font-semibold text-sm">
                      {index + 1}
                    </div>
                    <h2 className="text-xl font-semibold text-white">{step.title}</h2>
                  </div>

                  {step.content && (
                    <div className="prose prose-invert prose-slate max-w-none mb-4 ml-12">
                      <div
                        className="text-slate-400"
                        dangerouslySetInnerHTML={{
                          __html: step.content
                            .replace(/\*\*(.*?)\*\*/g, "<strong class='text-white'>$1</strong>")
                            .replace(/`([^`]+)`/g, "<code class='text-violet-400 bg-slate-800 px-1.5 py-0.5 rounded'>$1</code>")
                            .replace(/\n/g, "<br />")
                            .replace(/```([\s\S]*?)```/g, "<pre class='bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto'><code class='text-slate-300'>$1</code></pre>"),
                        }}
                      />
                    </div>
                  )}

                  {step.code && (
                    <div className="ml-12 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-700">
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <Terminal className="h-4 w-4" />
                          Terminal
                        </div>
                        <button className="text-slate-400 hover:text-white transition-colors">
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                      <pre className="p-4 text-sm overflow-x-auto">
                        <code className="text-slate-300">{step.code}</code>
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Unity Section */}
            <div className="mt-16 pt-12 border-t border-slate-800" id="unity">
              <h2 className="text-2xl font-bold text-white mb-4">Connecting from Unity</h2>
              <p className="text-slate-400 mb-8">
                To connect your Unity project to the Game On server, follow these steps:
              </p>

              <div className="space-y-6">
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    1. Copy the Unity SDK
                  </h3>
                  <p className="text-slate-400 mb-4">
                    Copy all files from <code className="text-violet-400 bg-slate-800 px-1.5 py-0.5 rounded">unity-sdk/</code> to your Unity project&apos;s <code className="text-violet-400 bg-slate-800 px-1.5 py-0.5 rounded">Assets/Scripts/Networking/</code> folder.
                  </p>
                  <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-300">
                    <pre>
{`unity-sdk/
├── GameOnClient.cs
├── GameOnNetworkManager.cs
├── GameOnNetworkIdentity.cs
├── GameOnPrediction.cs
├── GameOnTriviaManager.cs
├── GameOnTurnBasedManager.cs
└── GameOnMovementManager.cs`}
                    </pre>
                  </div>
                </div>

                <div className="rounded-lg bg-slate-900 border border-slate-800 p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    2. Create Network Manager
                  </h3>
                  <p className="text-slate-400 mb-4">
                    Create an empty GameObject and add the GameOnNetworkManager component:
                  </p>
                  <div className="rounded-lg bg-slate-800 p-4 text-sm overflow-x-auto">
                    <pre className="text-slate-300">
{`using UnityEngine;
using GameOnMultiplayer;

public class GameBootstrap : MonoBehaviour
{
    void Start()
    {
        // Configure server connection
        GameOnNetworkManager.Instance.ServerUrl = "ws://localhost:3000/ws";

        // Connect to server
        GameOnNetworkManager.Instance.Connect();
    }
}`}
                    </pre>
                  </div>
                </div>

                <div className="rounded-lg bg-slate-900 border border-slate-800 p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    3. Join a Room
                  </h3>
                  <p className="text-slate-400 mb-4">
                    Once connected, join or create a room:
                  </p>
                  <div className="rounded-lg bg-slate-800 p-4 text-sm overflow-x-auto">
                    <pre className="text-slate-300">
{`// Listen for connection
GameOnNetworkManager.Instance.OnConnected += () => {
    Debug.Log("Connected to server!");

    // Create a room
    GameOnNetworkManager.Instance.CreateRoom("lightning_round", new RoomOptions {
        MaxPlayers = 8
    });
};

// Listen for room join
GameOnNetworkManager.Instance.OnRoomJoined += (room) => {
    Debug.Log($"Joined room: {room.Id}");
};`}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            {/* Next Steps */}
            <div className="mt-16 pt-12 border-t border-slate-800">
              <h2 className="text-2xl font-bold text-white mb-6">Next Steps</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { title: "Core Concepts", description: "Learn about rooms, state sync, and matchmaking", href: "/docs/concepts/architecture" },
                  { title: "Unity SDK Guide", description: "Deep dive into the Unity integration", href: "/docs/unity-sdk" },
                  { title: "Build a Trivia Game", description: "Step-by-step tutorial", href: "/docs/guides/trivia-game" },
                  { title: "Deploy to Production", description: "AWS, Docker, and monitoring", href: "/docs/deployment/aws" },
                ].map((item) => (
                  <Link
                    key={item.title}
                    href={item.href}
                    className="group rounded-lg bg-slate-800/50 border border-slate-700 p-4 hover:border-violet-500/50 transition-all"
                  >
                    <h3 className="font-semibold text-white group-hover:text-violet-400 transition-colors mb-1">
                      {item.title}
                    </h3>
                    <p className="text-sm text-slate-400">{item.description}</p>
                  </Link>
                ))}
              </div>
            </div>

            {/* Navigation */}
            <div className="mt-12 pt-8 border-t border-slate-800 flex items-center justify-between">
              <Link
                href="/docs"
                className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Docs
              </Link>
              <Link
                href="/docs/concepts/architecture"
                className="flex items-center gap-2 text-violet-400 hover:text-violet-300 transition-colors"
              >
                Core Concepts
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <h4 className="text-sm font-semibold text-white mb-4">On This Page</h4>
              <nav className="space-y-2">
                {steps.map((step, index) => (
                  <a
                    key={step.title}
                    href={`#${step.title.toLowerCase().replace(/\s+/g, "-")}`}
                    className="block text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    {index + 1}. {step.title}
                  </a>
                ))}
                <a
                  href="#unity"
                  className="block text-sm text-slate-400 hover:text-white transition-colors pt-2 border-t border-slate-800 mt-4"
                >
                  Connecting from Unity
                </a>
              </nav>

              {/* AI Guide Download */}
              <div className="mt-8 p-4 rounded-lg bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  <h4 className="text-sm font-semibold text-violet-400">AI Integration</h4>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  Use AI to help integrate your game with Game On Dude!.
                </p>
                <a
                  href="/gameon-multiplayer-ai-integration-guide.md"
                  download="gameon-multiplayer-ai-integration-guide.md"
                  className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  <Download className="h-3 w-3" />
                  Download Guide
                </a>
              </div>

              <div className="mt-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                <h4 className="text-sm font-semibold text-white mb-2">Need Help?</h4>
                <p className="text-xs text-slate-400 mb-3">
                  Join our community for questions and support.
                </p>
                <a
                  href="https://github.com/gameon-guy/multiplayer-server/discussions"
                  className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub Discussions →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
