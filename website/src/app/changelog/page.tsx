import { Calendar, Tag, Zap, Shield, Wrench, Plus } from "lucide-react";

interface ChangelogEntry {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  changes: {
    category: "added" | "improved" | "fixed" | "security";
    items: string[];
  }[];
}

const changelog: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "December 2024",
    type: "major",
    changes: [
      {
        category: "added",
        items: [
          "Initial public release of Game On Dude!",
          "WebSocket-based real-time communication engine",
          "Room-based game architecture with automatic state synchronization",
          "Client-side prediction system for responsive gameplay",
          "Lag compensation module for fair hit detection",
          "Interpolation system for smooth remote player movement",
          "Unity SDK with network manager and prediction components",
          "TriviaRoom implementation for quiz-style games",
          "RealTimeMovementRoom for action and movement games",
          "TurnBasedRoom for card and strategy games",
          "PostgreSQL integration for persistent data storage",
          "Redis adapter for horizontal scaling across servers",
          "Prometheus-compatible metrics endpoint for monitoring",
          "Comprehensive test suite with 199+ unit tests",
        ],
      },
      {
        category: "improved",
        items: [
          "Delta compression reduces bandwidth by syncing only changed state",
          "Binary message encoding for efficient network transmission",
          "TypeScript throughout for type safety and better tooling",
        ],
      },
    ],
  },
  {
    version: "0.9.0",
    date: "November 2024",
    type: "minor",
    changes: [
      {
        category: "added",
        items: [
          "Netcode module with prediction, lag compensation, and interpolation",
          "LightningRoundRoom for fast-paced trivia gameplay",
          "HistoricalConquestRoom for turn-based card battles",
          "State tracking system with delta synchronization",
          "Middleware pipeline for request processing",
        ],
      },
      {
        category: "fixed",
        items: [
          "Memory leak in room disposal when clients disconnect unexpectedly",
          "Race condition in state synchronization during rapid updates",
        ],
      },
    ],
  },
  {
    version: "0.8.0",
    date: "October 2024",
    type: "minor",
    changes: [
      {
        category: "added",
        items: [
          "Database service with PostgreSQL connection pooling",
          "Redis caching layer for session management",
          "Health check endpoint for load balancer integration",
          "Graceful shutdown handling for zero-downtime deployments",
        ],
      },
      {
        category: "improved",
        items: [
          "Room lifecycle management with better resource cleanup",
          "Client reconnection handling with configurable timeout",
        ],
      },
      {
        category: "security",
        items: [
          "Input validation on all client messages",
          "Rate limiting to prevent message flooding",
        ],
      },
    ],
  },
  {
    version: "0.7.0",
    date: "September 2024",
    type: "minor",
    changes: [
      {
        category: "added",
        items: [
          "Unity SDK initial implementation",
          "GameOnNetworkManager component for connection handling",
          "GameOnPrediction component for client-side prediction",
          "Message serialization with JSON and binary support",
        ],
      },
      {
        category: "fixed",
        items: [
          "WebSocket connection stability on unreliable networks",
          "Message ordering issues during high-frequency updates",
        ],
      },
    ],
  },
];

const categoryConfig = {
  added: { label: "Added", icon: Plus, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  improved: { label: "Improved", icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10" },
  fixed: { label: "Fixed", icon: Wrench, color: "text-yellow-400", bg: "bg-yellow-500/10" },
  security: { label: "Security", icon: Shield, color: "text-red-400", bg: "bg-red-500/10" },
};

const typeColors = {
  major: "bg-violet-500",
  minor: "bg-blue-500",
  patch: "bg-slate-500",
};

export default function ChangelogPage() {
  return (
    <div className="pt-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-white mb-4">Changelog</h1>
          <p className="text-xl text-slate-400">
            Track the evolution of Game On Dude!. Every update, improvement, and fix documented.
          </p>
        </div>

        <div className="space-y-12">
          {changelog.map((entry) => (
            <article
              key={entry.version}
              className="relative pl-8 border-l-2 border-slate-700"
            >
              {/* Version marker */}
              <div className="absolute -left-3 top-0">
                <div className={`w-6 h-6 rounded-full ${typeColors[entry.type]} flex items-center justify-center`}>
                  <Tag className="h-3 w-3 text-white" />
                </div>
              </div>

              {/* Header */}
              <div className="flex flex-wrap items-center gap-4 mb-6">
                <h2 className="text-2xl font-bold text-white">v{entry.version}</h2>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Calendar className="h-4 w-4" />
                  {entry.date}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${typeColors[entry.type]} text-white capitalize`}>
                  {entry.type}
                </span>
              </div>

              {/* Changes */}
              <div className="space-y-6">
                {entry.changes.map((change) => {
                  const config = categoryConfig[change.category];
                  return (
                    <div key={change.category}>
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${config.bg} ${config.color} text-sm font-medium mb-3`}>
                        <config.icon className="h-4 w-4" />
                        {config.label}
                      </div>
                      <ul className="space-y-2 ml-1">
                        {change.items.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-3 text-slate-300">
                            <span className="text-slate-600 mt-1.5">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>

        {/* Subscribe section */}
        <div className="mt-16 p-8 rounded-2xl bg-slate-800/50 border border-slate-700 text-center">
          <h3 className="text-xl font-semibold text-white mb-2">Stay Updated</h3>
          <p className="text-slate-400 mb-6">
            Follow us on social media to get notified about new releases and updates.
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="https://x.com/GameOnGuyEdu"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
            >
              Follow on X
            </a>
            <a
              href="https://www.linkedin.com/company/gameon-guy-inc/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
            >
              Follow on LinkedIn
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
