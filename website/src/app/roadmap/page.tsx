import { CheckCircle2, Circle, Clock, Sparkles, Target, Rocket, Users, Globe } from "lucide-react";

interface RoadmapItem {
  title: string;
  description: string;
  status: "completed" | "in-progress" | "planned" | "considering";
  quarter?: string;
}

interface RoadmapSection {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: RoadmapItem[];
}

const roadmap: RoadmapSection[] = [
  {
    title: "Core Platform",
    icon: Rocket,
    items: [
      {
        title: "WebSocket Server Foundation",
        description: "Real-time communication layer with connection management and message routing",
        status: "completed",
      },
      {
        title: "Room-Based Architecture",
        description: "Isolated game sessions with automatic lifecycle management",
        status: "completed",
      },
      {
        title: "State Synchronization",
        description: "Automatic delta compression and efficient state updates to all clients",
        status: "completed",
      },
      {
        title: "Netcode Module",
        description: "Client-side prediction, lag compensation, and interpolation systems",
        status: "completed",
      },
      {
        title: "Horizontal Scaling",
        description: "Redis-based room distribution across multiple server instances",
        status: "completed",
      },
      {
        title: "WebRTC Data Channels",
        description: "Peer-to-peer communication option for reduced latency scenarios",
        status: "planned",
        quarter: "Q2 2025",
      },
    ],
  },
  {
    title: "Game Templates",
    icon: Target,
    items: [
      {
        title: "Trivia Room",
        description: "Quiz games with timed rounds, scoring, and leaderboards",
        status: "completed",
      },
      {
        title: "Real-Time Movement Room",
        description: "Action games with position sync and collision detection",
        status: "completed",
      },
      {
        title: "Turn-Based Room",
        description: "Card games and strategy games with turn management",
        status: "completed",
      },
      {
        title: "Battle Royale Template",
        description: "Large-scale elimination games with zone mechanics",
        status: "planned",
        quarter: "Q2 2025",
      },
      {
        title: "Racing Game Template",
        description: "Vehicle physics sync with checkpoint and lap systems",
        status: "considering",
      },
    ],
  },
  {
    title: "Client SDKs",
    icon: Users,
    items: [
      {
        title: "Unity SDK",
        description: "Full-featured SDK with network manager, prediction, and serialization",
        status: "completed",
      },
      {
        title: "Unity SDK v2",
        description: "Visual scripting support and improved editor integration",
        status: "in-progress",
        quarter: "Q1 2025",
      },
      {
        title: "Unreal Engine SDK",
        description: "Native C++ SDK for Unreal Engine 5 projects",
        status: "planned",
        quarter: "Q3 2025",
      },
      {
        title: "Godot SDK",
        description: "GDScript and C# SDK for Godot 4 engine",
        status: "considering",
      },
      {
        title: "Web SDK (JavaScript)",
        description: "Browser-based games with TypeScript support",
        status: "planned",
        quarter: "Q2 2025",
      },
    ],
  },
  {
    title: "Infrastructure & Tools",
    icon: Globe,
    items: [
      {
        title: "PostgreSQL Integration",
        description: "Persistent storage for user data, matches, and leaderboards",
        status: "completed",
      },
      {
        title: "Redis Caching",
        description: "Session management and real-time data caching",
        status: "completed",
      },
      {
        title: "Prometheus Metrics",
        description: "Built-in monitoring and alerting capabilities",
        status: "completed",
      },
      {
        title: "Admin Dashboard",
        description: "Web-based interface for server management and analytics",
        status: "in-progress",
        quarter: "Q1 2025",
      },
      {
        title: "Cloud Deployment Templates",
        description: "One-click deployment for AWS, GCP, and Azure",
        status: "planned",
        quarter: "Q2 2025",
      },
      {
        title: "Matchmaking Service",
        description: "Skill-based matchmaking with queue management",
        status: "planned",
        quarter: "Q3 2025",
      },
    ],
  },
];

const statusConfig = {
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  "in-progress": {
    label: "In Progress",
    icon: Clock,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  planned: {
    label: "Planned",
    icon: Circle,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
  },
  considering: {
    label: "Under Consideration",
    icon: Sparkles,
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
  },
};

export default function RoadmapPage() {
  return (
    <div className="pt-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-white mb-4">Product Roadmap</h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto">
            Our vision for the future of Game On Dude!. See what we&apos;ve built,
            what we&apos;re working on, and where we&apos;re headed.
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-4 mb-12">
          {Object.entries(statusConfig).map(([key, config]) => (
            <div key={key} className="flex items-center gap-2">
              <config.icon className={`h-4 w-4 ${config.color}`} />
              <span className="text-sm text-slate-400">{config.label}</span>
            </div>
          ))}
        </div>

        {/* Roadmap sections */}
        <div className="space-y-12">
          {roadmap.map((section) => (
            <section key={section.title}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <section.icon className="h-5 w-5 text-violet-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">{section.title}</h2>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.items.map((item) => {
                  const config = statusConfig[item.status];
                  return (
                    <div
                      key={item.title}
                      className={`rounded-xl bg-slate-800/50 border ${config.border} p-5`}
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <h3 className="font-semibold text-white">{item.title}</h3>
                        <config.icon className={`h-5 w-5 ${config.color} flex-shrink-0`} />
                      </div>
                      <p className="text-sm text-slate-400 mb-3">{item.description}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                        {item.quarter && (
                          <span className="text-xs text-slate-500">{item.quarter}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Feedback section */}
        <div className="mt-16 p-8 rounded-2xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/30 text-center">
          <Sparkles className="h-8 w-8 text-violet-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Shape Our Roadmap</h3>
          <p className="text-slate-400 mb-6 max-w-xl mx-auto">
            Have a feature request or idea? We build Game On Dude! based on real developer needs.
            Your input directly influences our priorities.
          </p>
          <a
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500 transition-colors"
          >
            Share Your Ideas
          </a>
        </div>
      </div>
    </div>
  );
}
