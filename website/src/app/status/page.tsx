import { CheckCircle2, AlertCircle, Clock, Activity, Server, Database, Globe, Zap } from "lucide-react";

interface ServiceStatus {
  name: string;
  status: "operational" | "degraded" | "outage" | "maintenance";
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  uptime: string;
  responseTime?: string;
}

const services: ServiceStatus[] = [
  {
    name: "Game Servers",
    status: "operational",
    description: "WebSocket connections and room management",
    icon: Server,
    uptime: "99.98%",
    responseTime: "4ms",
  },
  {
    name: "Database",
    status: "operational",
    description: "PostgreSQL for persistent data storage",
    icon: Database,
    uptime: "99.99%",
    responseTime: "2ms",
  },
  {
    name: "Redis Cache",
    status: "operational",
    description: "Session management and real-time caching",
    icon: Zap,
    uptime: "99.99%",
    responseTime: "1ms",
  },
  {
    name: "API Gateway",
    status: "operational",
    description: "REST API and authentication services",
    icon: Globe,
    uptime: "99.97%",
    responseTime: "12ms",
  },
];

interface Incident {
  id: string;
  title: string;
  status: "resolved" | "monitoring" | "investigating" | "identified";
  date: string;
  updates: { time: string; message: string }[];
}

const recentIncidents: Incident[] = [
  {
    id: "inc-001",
    title: "Elevated connection latency",
    status: "resolved",
    date: "November 28, 2024",
    updates: [
      { time: "14:30 UTC", message: "Issue resolved. Root cause was network congestion at upstream provider." },
      { time: "14:15 UTC", message: "Fix deployed. Monitoring for improvement." },
      { time: "14:00 UTC", message: "Identified increased latency on US-East servers. Investigating." },
    ],
  },
];

const statusConfig = {
  operational: {
    label: "Operational",
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    dot: "bg-emerald-400",
  },
  degraded: {
    label: "Degraded",
    icon: AlertCircle,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    dot: "bg-yellow-400",
  },
  outage: {
    label: "Outage",
    icon: AlertCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    dot: "bg-red-400",
  },
  maintenance: {
    label: "Maintenance",
    icon: Clock,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    dot: "bg-blue-400",
  },
};

const incidentStatusConfig = {
  resolved: { label: "Resolved", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  monitoring: { label: "Monitoring", color: "text-blue-400", bg: "bg-blue-500/10" },
  investigating: { label: "Investigating", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  identified: { label: "Identified", color: "text-orange-400", bg: "bg-orange-500/10" },
};

export default function StatusPage() {
  const allOperational = services.every((s) => s.status === "operational");

  return (
    <div className="pt-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Overall status */}
        <div className={`rounded-2xl p-8 mb-12 ${allOperational ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-yellow-500/10 border border-yellow-500/30"}`}>
          <div className="flex items-center gap-4">
            {allOperational ? (
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            ) : (
              <AlertCircle className="h-12 w-12 text-yellow-400" />
            )}
            <div>
              <h1 className="text-2xl font-bold text-white">
                {allOperational ? "All Systems Operational" : "Partial System Outage"}
              </h1>
              <p className="text-slate-400">
                {allOperational
                  ? "Game On Dude! services are running smoothly."
                  : "Some services are experiencing issues. We're working on it."}
              </p>
            </div>
          </div>
        </div>

        {/* Service status */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-6">Service Status</h2>
          <div className="space-y-4">
            {services.map((service) => {
              const config = statusConfig[service.status];
              return (
                <div
                  key={service.name}
                  className="rounded-xl bg-slate-800/50 border border-slate-700 p-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
                        <service.icon className="h-5 w-5 text-slate-300" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{service.name}</h3>
                        <p className="text-sm text-slate-400">{service.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {service.responseTime && (
                        <div className="text-right hidden sm:block">
                          <p className="text-sm text-slate-400">Response</p>
                          <p className="text-sm font-medium text-white">{service.responseTime}</p>
                        </div>
                      )}
                      <div className="text-right hidden sm:block">
                        <p className="text-sm text-slate-400">Uptime</p>
                        <p className="text-sm font-medium text-white">{service.uptime}</p>
                      </div>
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bg}`}>
                        <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Uptime graph placeholder */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-6">90-Day Uptime</h2>
          <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-6">
            <div className="flex items-end justify-between gap-1 h-24 mb-4">
              {Array.from({ length: 90 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 bg-emerald-500 rounded-sm min-w-[2px]"
                  style={{ height: `${85 + Math.random() * 15}%` }}
                  title={`Day ${90 - i}: 99.9%+`}
                />
              ))}
            </div>
            <div className="flex justify-between text-sm text-slate-400">
              <span>90 days ago</span>
              <span className="text-emerald-400 font-medium">99.98% average uptime</span>
              <span>Today</span>
            </div>
          </div>
        </section>

        {/* Recent incidents */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-6">Recent Incidents</h2>
          {recentIncidents.length === 0 ? (
            <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
              <p className="text-slate-400">No incidents in the past 90 days.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {recentIncidents.map((incident) => {
                const config = incidentStatusConfig[incident.status];
                return (
                  <div
                    key={incident.id}
                    className="rounded-xl bg-slate-800/50 border border-slate-700 overflow-hidden"
                  >
                    <div className="px-6 py-4 border-b border-slate-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-white">{incident.title}</h3>
                          <p className="text-sm text-slate-400">{incident.date}</p>
                        </div>
                        <span className={`text-sm px-3 py-1 rounded-full ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                      </div>
                    </div>
                    <div className="px-6 py-4 space-y-3">
                      {incident.updates.map((update, idx) => (
                        <div key={idx} className="flex gap-4 text-sm">
                          <span className="text-slate-500 whitespace-nowrap">{update.time}</span>
                          <span className="text-slate-300">{update.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Subscribe */}
        <section className="rounded-2xl bg-slate-800/50 border border-slate-700 p-8 text-center">
          <Activity className="h-8 w-8 text-violet-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Stay Informed</h3>
          <p className="text-slate-400 mb-6">
            Follow us on social media to receive updates about system status and maintenance windows.
          </p>
          <a
            href="https://x.com/GameOnGuyEdu"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500 transition-colors"
          >
            Follow @GameOnGuyEdu
          </a>
        </section>
      </div>
    </div>
  );
}
