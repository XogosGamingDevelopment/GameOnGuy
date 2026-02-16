import Link from "next/link";
import {
  BookOpen,
  Rocket,
  Code,
  Gamepad2,
  Server,
  Database,
  Shield,
  Zap,
  ArrowRight,
  FileCode,
  Box,
  Network,
} from "lucide-react";

interface DocLink {
  name: string;
  href: string;
  time?: string;
}

interface DocSection {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  links: DocLink[];
}

const sections: DocSection[] = [
  {
    title: "Getting Started",
    description: "New to Game On Dude!? Start here.",
    icon: Rocket,
    links: [
      { name: "Quick Start Guide", href: "/docs/getting-started", time: "5 min" },
      { name: "Installation", href: "/docs/getting-started#installation", time: "2 min" },
      { name: "Your First Server", href: "/docs/getting-started#first-server", time: "5 min" },
      { name: "Connecting from Unity", href: "/docs/getting-started#unity", time: "10 min" },
    ],
  },
  {
    title: "Core Concepts",
    description: "Understand the architecture and key concepts.",
    icon: BookOpen,
    links: [
      { name: "Server Architecture", href: "/docs/concepts/architecture" },
      { name: "Rooms & Matchmaking", href: "/docs/concepts/rooms" },
      { name: "State Synchronization", href: "/docs/concepts/state-sync" },
      { name: "Message Protocol", href: "/docs/concepts/protocol" },
    ],
  },
  {
    title: "Netcode",
    description: "Client-side prediction, lag compensation, and interpolation.",
    icon: Zap,
    links: [
      { name: "Overview", href: "/docs/netcode/overview" },
      { name: "Client Prediction", href: "/docs/netcode/prediction" },
      { name: "Lag Compensation", href: "/docs/netcode/lag-compensation" },
      { name: "Interpolation", href: "/docs/netcode/interpolation" },
    ],
  },
  {
    title: "Unity SDK",
    description: "Integrate with your Unity project.",
    icon: Gamepad2,
    links: [
      { name: "Installation", href: "/docs/unity-sdk/installation" },
      { name: "Network Manager", href: "/docs/unity-sdk/network-manager" },
      { name: "Trivia Manager", href: "/docs/unity-sdk/trivia-manager" },
      { name: "Migration from Photon", href: "/docs/unity-sdk/migration" },
    ],
  },
  {
    title: "Game Rooms",
    description: "Pre-built room types for different game genres.",
    icon: Box,
    links: [
      { name: "TriviaRoom", href: "/docs/rooms/trivia" },
      { name: "RealTimeMovementRoom", href: "/docs/rooms/movement" },
      { name: "TurnBasedRoom", href: "/docs/rooms/turn-based" },
      { name: "Custom Rooms", href: "/docs/rooms/custom" },
    ],
  },
  {
    title: "Infrastructure",
    description: "Database, caching, and scaling.",
    icon: Server,
    links: [
      { name: "PostgreSQL Setup", href: "/docs/infrastructure/postgresql" },
      { name: "Redis Setup", href: "/docs/infrastructure/redis" },
      { name: "Horizontal Scaling", href: "/docs/infrastructure/scaling" },
      { name: "Docker Deployment", href: "/docs/infrastructure/docker" },
    ],
  },
  {
    title: "API Reference",
    description: "Complete API documentation.",
    icon: FileCode,
    links: [
      { name: "Server API", href: "/docs/api/server" },
      { name: "Room API", href: "/docs/api/room" },
      { name: "Client Messages", href: "/docs/api/messages" },
      { name: "TypeScript Types", href: "/docs/api/types" },
    ],
  },
  {
    title: "Deployment",
    description: "Deploy to production.",
    icon: Network,
    links: [
      { name: "AWS (ECS)", href: "/docs/deployment/aws" },
      { name: "DigitalOcean", href: "/docs/deployment/digitalocean" },
      { name: "Docker Compose", href: "/docs/deployment/docker-compose" },
      { name: "Monitoring", href: "/docs/deployment/monitoring" },
    ],
  },
];

const popularGuides = [
  {
    title: "Build a Trivia Game",
    description: "Create a multiplayer trivia game from scratch with Lightning Round mechanics.",
    href: "/docs/guides/trivia-game",
    icon: Gamepad2,
    difficulty: "Beginner",
  },
  {
    title: "Add Prediction to Your Game",
    description: "Implement client-side prediction for responsive gameplay.",
    href: "/docs/guides/prediction",
    icon: Zap,
    difficulty: "Intermediate",
  },
  {
    title: "Scale to 10,000 Players",
    description: "Configure horizontal scaling with Redis and load balancing.",
    href: "/docs/guides/scaling",
    icon: Server,
    difficulty: "Advanced",
  },
];

export default function DocsPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="py-16 lg:py-20 bg-gradient-to-b from-violet-950/30 to-slate-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">Documentation</h1>
            <p className="text-xl text-slate-400 mb-8">
              Everything you need to build multiplayer games with Game On Dude!.
              From quick start to advanced scaling.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/docs/getting-started"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-3 text-base font-semibold text-white hover:from-violet-500 hover:to-fuchsia-500 transition-all"
              >
                <Rocket className="h-4 w-4" />
                Quick Start
              </Link>
              <Link
                href="/docs/api"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-6 py-3 text-base font-semibold text-white ring-1 ring-white/10 hover:bg-white/10 transition-all"
              >
                <Code className="h-4 w-4" />
                API Reference
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Popular Guides */}
      <section className="py-12 border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-lg font-semibold text-slate-400 mb-6">Popular Guides</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {popularGuides.map((guide) => (
              <Link
                key={guide.title}
                href={guide.href}
                className="group rounded-xl bg-slate-800/50 border border-slate-700 p-6 hover:border-violet-500/50 transition-all"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <guide.icon className="h-5 w-5 text-violet-400" />
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      guide.difficulty === "Beginner"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : guide.difficulty === "Intermediate"
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {guide.difficulty}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-violet-400 transition-colors">
                  {guide.title}
                </h3>
                <p className="text-sm text-slate-400">{guide.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Documentation Sections */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {sections.map((section) => (
              <div key={section.title} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <section.icon className="h-4 w-4 text-violet-400" />
                  </div>
                  <h3 className="font-semibold text-white">{section.title}</h3>
                </div>
                <p className="text-sm text-slate-500">{section.description}</p>
                <ul className="space-y-2">
                  {section.links.map((link) => (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        className="flex items-center justify-between text-sm text-slate-400 hover:text-white transition-colors py-1"
                      >
                        <span>{link.name}</span>
                        {link.time && (
                          <span className="text-xs text-slate-600">{link.time}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Help Section */}
      <section className="py-16 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-8 md:p-12">
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <h2 className="text-2xl font-bold text-white mb-4">Need Help?</h2>
                <p className="text-slate-400 mb-6">
                  Can&apos;t find what you&apos;re looking for? Our community and support team are here to help.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <a
                    href="https://github.com/gameon-guy/multiplayer-server/discussions"
                    className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300 transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub Discussions
                    <ArrowRight className="h-4 w-4" />
                  </a>
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    Contact Support
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-slate-700/50 p-4 text-center">
                  <div className="text-2xl font-bold text-white">199+</div>
                  <div className="text-sm text-slate-400">Unit Tests</div>
                </div>
                <div className="rounded-lg bg-slate-700/50 p-4 text-center">
                  <div className="text-2xl font-bold text-white">5</div>
                  <div className="text-sm text-slate-400">Game Types</div>
                </div>
                <div className="rounded-lg bg-slate-700/50 p-4 text-center">
                  <div className="text-2xl font-bold text-white">100%</div>
                  <div className="text-sm text-slate-400">TypeScript</div>
                </div>
                <div className="rounded-lg bg-slate-700/50 p-4 text-center">
                  <div className="text-2xl font-bold text-white">MIT</div>
                  <div className="text-sm text-slate-400">License</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
