import Link from "next/link";
import {
  Zap,
  Shield,
  Globe,
  Code,
  Server,
  Gamepad2,
  ArrowRight,
  Database,
  Activity,
  Lock,
  Layers,
  Cpu,
  Network,
  Clock,
  Users,
  BarChart3,
  Box,
} from "lucide-react";

const featureCategories = [
  {
    title: "Netcode",
    description: "Professional-grade networking for responsive gameplay",
    features: [
      {
        name: "Client-Side Prediction",
        description: "Players see instant feedback for their actions. The client predicts movement locally while waiting for server confirmation, making games feel responsive even with 200ms latency.",
        icon: Zap,
        details: [
          "Automatic input buffering and sequencing",
          "Server reconciliation on misprediction",
          "Configurable prediction smoothing",
          "Works with any game state type",
        ],
      },
      {
        name: "Lag Compensation",
        description: "Server-side hit detection that rewinds game state to the moment a player fired. Everyone gets fair gameplay regardless of their ping.",
        icon: Shield,
        details: [
          "Configurable rewind window (default 300ms)",
          "Point and raycast hit validation",
          "Per-entity hitbox support",
          "Automatic history management",
        ],
      },
      {
        name: "Entity Interpolation",
        description: "Smooth movement for remote players using snapshot interpolation. Eliminates jitter and provides fluid visuals even with infrequent updates.",
        icon: Activity,
        details: [
          "Configurable interpolation delay",
          "Hermite spline smoothing",
          "Dead reckoning for extrapolation",
          "Automatic stale state detection",
        ],
      },
    ],
  },
  {
    title: "Infrastructure",
    description: "Scale from prototype to production with built-in integrations",
    features: [
      {
        name: "PostgreSQL Integration",
        description: "Built-in database service with connection pooling, transactions, and repository pattern. Store user accounts, match history, and leaderboards.",
        icon: Database,
        details: [
          "Connection pooling with configurable limits",
          "Automatic retry with exponential backoff",
          "Transaction support with rollback",
          "Ready-made repositories for users, matches, questions",
        ],
      },
      {
        name: "Redis Integration",
        description: "Full Redis support for caching, sessions, pub/sub, and cross-server communication. Essential for horizontal scaling.",
        icon: Server,
        details: [
          "Session management with TTL",
          "Pub/sub for real-time events",
          "Room synchronization across servers",
          "Sorted sets for leaderboards",
        ],
      },
      {
        name: "Horizontal Scaling",
        description: "Run multiple server instances behind a load balancer. Redis-powered room sync ensures players can find each other across servers.",
        icon: Globe,
        details: [
          "Automatic server registration",
          "Room discovery across instances",
          "Sticky sessions for WebSocket",
          "Health-based load balancing",
        ],
      },
    ],
  },
  {
    title: "Game Development",
    description: "Pre-built room types and Unity SDK for rapid development",
    features: [
      {
        name: "Room Types",
        description: "Three base room classes covering the most common multiplayer patterns. Extend them or use them as-is.",
        icon: Layers,
        details: [
          "TriviaRoom: Questions, timers, scoring",
          "RealTimeMovementRoom: 20-60Hz tick rate",
          "TurnBasedRoom: Turn order, action validation",
          "Full game implementations included",
        ],
      },
      {
        name: "Unity SDK",
        description: "Drop-in C# client that mirrors the Photon PUN API. Migrate existing games with minimal code changes.",
        icon: Gamepad2,
        details: [
          "Game OnNetworkManager (like PhotonNetwork)",
          "Built-in prediction and interpolation",
          "Game-specific managers included",
          "Comprehensive migration guide",
        ],
      },
      {
        name: "Schema System",
        description: "Decorator-based state management with automatic change tracking. Only send what changed to minimize bandwidth.",
        icon: Box,
        details: [
          "TypeScript decorators for state definition",
          "Automatic delta generation",
          "Binary encoding option",
          "Collection types (Array, Map, Set)",
        ],
      },
    ],
  },
  {
    title: "Production Ready",
    description: "Monitoring, security, and reliability built-in",
    features: [
      {
        name: "Monitoring",
        description: "Prometheus-compatible metrics for connections, rooms, latency, and custom game events. Plug into Grafana for dashboards.",
        icon: BarChart3,
        details: [
          "Counters, gauges, and histograms",
          "System metrics (CPU, memory)",
          "Custom game event tracking",
          "Health check endpoints",
        ],
      },
      {
        name: "Authentication",
        description: "JWT-based authentication with guest mode support. Integrate with your existing auth system or use standalone.",
        icon: Lock,
        details: [
          "JWT token validation",
          "Guest authentication",
          "Session management",
          "Configurable expiry",
        ],
      },
      {
        name: "Middleware Pipeline",
        description: "Intercept and transform messages with composable middleware. Add rate limiting, validation, and logging with one line.",
        icon: Network,
        details: [
          "Rate limiting per client",
          "Message validation",
          "Structured logging",
          "Custom middleware support",
        ],
      },
    ],
  },
];

const comparisonFeatures = [
  { feature: "Per-CCU Pricing", gameon: "No", photon: "Yes", colyseus: "No" },
  { feature: "Client Prediction", gameon: "Built-in", photon: "Manual", colyseus: "Manual" },
  { feature: "Lag Compensation", gameon: "Built-in", photon: "No", colyseus: "No" },
  { feature: "Unity SDK", gameon: "Yes", photon: "Yes", colyseus: "Yes" },
  { feature: "Source Access", gameon: "Full", photon: "No", colyseus: "Full" },
  { feature: "TypeScript", gameon: "100%", photon: "N/A", colyseus: "Yes" },
  { feature: "PostgreSQL", gameon: "Built-in", photon: "External", colyseus: "External" },
  { feature: "Redis", gameon: "Built-in", photon: "N/A", colyseus: "External" },
  { feature: "Monitoring", gameon: "Prometheus", photon: "Dashboard", colyseus: "External" },
];

export default function FeaturesPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Everything You Need for{" "}
              <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                Multiplayer Games
              </span>
            </h1>
            <p className="text-xl text-slate-400">
              Professional netcode, built-in infrastructure, and production-ready tooling.
              Stop reinventing the wheel and focus on your game.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Categories */}
      {featureCategories.map((category, categoryIndex) => (
        <section
          key={category.title}
          className={`py-16 lg:py-24 ${categoryIndex % 2 === 1 ? "bg-slate-900/50" : ""}`}
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-white mb-4">{category.title}</h2>
              <p className="text-lg text-slate-400">{category.description}</p>
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
              {category.features.map((feature) => (
                <div
                  key={feature.name}
                  className="rounded-2xl bg-slate-800/50 border border-slate-700 p-8 hover:border-violet-500/50 transition-all"
                >
                  <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-6">
                    <feature.icon className="h-6 w-6 text-violet-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-3">{feature.name}</h3>
                  <p className="text-slate-400 mb-6">{feature.description}</p>
                  <ul className="space-y-2">
                    {feature.details.map((detail) => (
                      <li key={detail} className="flex items-start gap-2 text-sm text-slate-300">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-2 flex-shrink-0" />
                        {detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* Comparison Table */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">How We Compare</h2>
            <p className="text-lg text-slate-400">
              See how Game On Dude! stacks up against other solutions
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-4 px-6 text-slate-400 font-medium">Feature</th>
                  <th className="text-center py-4 px-6 text-violet-400 font-semibold">Game On</th>
                  <th className="text-center py-4 px-6 text-slate-400 font-medium">Photon</th>
                  <th className="text-center py-4 px-6 text-slate-400 font-medium">Colyseus</th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((row) => (
                  <tr key={row.feature} className="border-b border-slate-800">
                    <td className="py-4 px-6 text-slate-300">{row.feature}</td>
                    <td className="py-4 px-6 text-center">
                      <span className={row.gameon === "No" ? "text-red-400" : "text-emerald-400"}>
                        {row.gameon}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center text-slate-400">{row.photon}</td>
                    <td className="py-4 px-6 text-center text-slate-400">{row.colyseus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Get Started?</h2>
          <p className="text-lg text-slate-400 mb-8 max-w-2xl mx-auto">
            Check out our documentation to start building, or contact us for enterprise support.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg hover:from-violet-500 hover:to-fuchsia-500 transition-all"
            >
              View Documentation
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-8 py-3.5 text-base font-semibold text-white ring-1 ring-white/10 hover:bg-white/10 transition-all"
            >
              See Pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
