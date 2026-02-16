import Link from "next/link";
import {
  ArrowLeft,
  Cloud,
  Container,
  Server,
  Activity,
  ChevronRight,
  Copy,
  AlertTriangle,
  Check,
  Terminal,
} from "lucide-react";

const deploymentOptions = [
  {
    id: "docker",
    name: "Docker Compose",
    description: "Perfect for development and small deployments",
    difficulty: "Easy",
    icon: Container,
    recommended: true,
  },
  {
    id: "aws",
    name: "AWS (ECS)",
    description: "Production-ready, auto-scaling infrastructure",
    difficulty: "Intermediate",
    icon: Cloud,
    recommended: false,
  },
  {
    id: "digitalocean",
    name: "DigitalOcean",
    description: "Simple cloud deployment with App Platform",
    difficulty: "Easy",
    icon: Server,
    recommended: false,
  },
];

const dockerComposeConfig = `version: '3.8'

services:
  gameon-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/gameon
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=your-secret-key
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: gameon
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    restart: unless-stopped

  # Optional: Monitoring
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana

volumes:
  postgres_data:
  redis_data:
  grafana_data:`;

const dockerfile = `FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 gameon
USER gameon

COPY --from=builder --chown=gameon:nodejs /app/dist ./dist
COPY --from=builder --chown=gameon:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=gameon:nodejs /app/package.json ./

EXPOSE 3000

CMD ["node", "dist/index.js"]`;

const awsTaskDef = `{
  "family": "gameon-server",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "gameon-server",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/gameon-server:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:gameon/database"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:gameon/redis"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/gameon-server",
          "awslogs-region": "REGION",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}`;

const scalingConfig = `# Horizontal scaling with multiple instances

# 1. Redis for session sharing
REDIS_URL=redis://redis-cluster:6379

# 2. Load balancer configuration (nginx example)
upstream gameon_servers {
    ip_hash;  # Sticky sessions for WebSocket
    server gameon-1:3000;
    server gameon-2:3000;
    server gameon-3:3000;
}

server {
    listen 80;

    location / {
        proxy_pass http://gameon_servers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}`;

const monitoringSetup = `# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'gameon-server'
    static_configs:
      - targets: ['gameon-server:3000']
    metrics_path: /metrics

# Key metrics to monitor:
# - gameon_connected_clients (gauge)
# - gameon_active_rooms (gauge)
# - gameon_messages_per_second (counter)
# - gameon_room_join_duration (histogram)
# - gameon_state_sync_size_bytes (histogram)`;

function CodeBlock({ code, language = "yaml", filename }: { code: string; language?: string; filename?: string }) {
  return (
    <div className="relative group">
      {filename && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800 rounded-t-lg">
          <Terminal className="h-4 w-4 text-slate-500" />
          <span className="text-sm text-slate-400 font-mono">{filename}</span>
        </div>
      )}
      <pre className={`bg-slate-950 border border-slate-800 p-4 overflow-x-auto text-sm ${filename ? 'rounded-b-lg border-t-0' : 'rounded-lg'}`}>
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

export default function DeploymentPage() {
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
                  Deployment
                </p>
                <a
                  href="#options"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Cloud className="h-4 w-4" />
                  Options
                </a>
                <a
                  href="#docker"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Container className="h-4 w-4" />
                  Docker Compose
                </a>
                <a
                  href="#aws"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Cloud className="h-4 w-4" />
                  AWS (ECS)
                </a>
                <a
                  href="#scaling"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Server className="h-4 w-4" />
                  Scaling
                </a>
                <a
                  href="#monitoring"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Activity className="h-4 w-4" />
                  Monitoring
                </a>
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <div className="mb-12">
              <h1 className="text-4xl font-bold text-white mb-4">Deployment Guide</h1>
              <p className="text-xl text-slate-400">
                Deploy Game On Dude! to production with confidence.
              </p>
            </div>

            {/* Deployment Options */}
            <section id="options" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-6">Deployment Options</h2>

              <div className="grid md:grid-cols-3 gap-6">
                {deploymentOptions.map((option) => (
                  <div
                    key={option.id}
                    className={`rounded-xl bg-slate-800/30 border p-6 ${
                      option.recommended
                        ? "border-violet-500/50 ring-1 ring-violet-500/20"
                        : "border-slate-700"
                    }`}
                  >
                    {option.recommended && (
                      <span className="inline-block text-xs font-medium text-violet-400 bg-violet-500/10 px-2 py-1 rounded-full mb-4">
                        Recommended
                      </span>
                    )}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                        <option.icon className="h-5 w-5 text-violet-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{option.name}</h3>
                        <span
                          className={`text-xs ${
                            option.difficulty === "Easy"
                              ? "text-emerald-400"
                              : "text-yellow-400"
                          }`}
                        >
                          {option.difficulty}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-400">{option.description}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Docker Compose */}
            <section id="docker" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-2">Docker Compose</h2>
              <p className="text-slate-400 mb-6">
                The fastest way to deploy GameOn with all dependencies.
              </p>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-white mb-3">1. Create Dockerfile</h3>
                  <CodeBlock code={dockerfile} language="dockerfile" filename="Dockerfile" />
                </div>

                <div>
                  <h3 className="font-semibold text-white mb-3">2. Create docker-compose.yml</h3>
                  <CodeBlock code={dockerComposeConfig} language="yaml" filename="docker-compose.yml" />
                </div>

                <div>
                  <h3 className="font-semibold text-white mb-3">3. Deploy</h3>
                  <CodeBlock
                    code={`# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f gameon-server

# Scale horizontally
docker-compose up -d --scale gameon-server=3`}
                    language="bash"
                  />
                </div>

                <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex gap-3">
                    <Check className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-emerald-400 font-medium">Production Checklist</p>
                      <ul className="mt-2 space-y-1 text-sm text-slate-300">
                        <li>• Use strong passwords for PostgreSQL and Redis</li>
                        <li>• Set a secure JWT_SECRET (use openssl rand -base64 32)</li>
                        <li>• Enable TLS/SSL for WebSocket connections</li>
                        <li>• Configure proper resource limits</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* AWS */}
            <section id="aws" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-2">AWS (ECS Fargate)</h2>
              <p className="text-slate-400 mb-6">
                Deploy to AWS with auto-scaling and managed infrastructure.
              </p>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-white mb-3">Architecture Overview</h3>
                  <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-6">
                    <ul className="space-y-3 text-sm">
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs flex-shrink-0">1</span>
                        <span className="text-slate-300"><strong className="text-white">Application Load Balancer</strong> — WebSocket-aware with sticky sessions</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs flex-shrink-0">2</span>
                        <span className="text-slate-300"><strong className="text-white">ECS Fargate</strong> — Serverless container orchestration</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs flex-shrink-0">3</span>
                        <span className="text-slate-300"><strong className="text-white">RDS PostgreSQL</strong> — Managed database with backups</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs flex-shrink-0">4</span>
                        <span className="text-slate-300"><strong className="text-white">ElastiCache Redis</strong> — Managed Redis for session sharing</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-white mb-3">ECS Task Definition</h3>
                  <CodeBlock code={awsTaskDef} language="json" filename="task-definition.json" />
                </div>

                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 font-medium">WebSocket Considerations</p>
                      <p className="mt-1 text-sm text-slate-300">
                        Configure ALB idle timeout to at least 3600 seconds for long-lived WebSocket
                        connections. Use sticky sessions (stickiness.enabled) to ensure clients
                        reconnect to the same instance.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Scaling */}
            <section id="scaling" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-2">Horizontal Scaling</h2>
              <p className="text-slate-400 mb-6">
                Scale to thousands of concurrent players with proper configuration.
              </p>

              <div className="space-y-6">
                <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-6">
                  <h3 className="font-semibold text-white mb-4">Key Requirements</h3>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <Check className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-white font-medium">Redis for Presence</span>
                        <p className="text-sm text-slate-400">All server instances share player/room state via Redis</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-white font-medium">Sticky Sessions</span>
                        <p className="text-sm text-slate-400">Load balancer routes clients to same server for WebSocket</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-white font-medium">Room Affinity</span>
                        <p className="text-sm text-slate-400">Players in the same room connect to the same server</p>
                      </div>
                    </li>
                  </ul>
                </div>

                <CodeBlock code={scalingConfig} language="nginx" filename="nginx.conf" />

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="rounded-lg bg-slate-800/50 p-4 text-center">
                    <div className="text-2xl font-bold text-white">1</div>
                    <div className="text-sm text-slate-400">Server = 500 CCU</div>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 p-4 text-center">
                    <div className="text-2xl font-bold text-white">5</div>
                    <div className="text-sm text-slate-400">Servers = 2,500 CCU</div>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 p-4 text-center">
                    <div className="text-2xl font-bold text-white">20</div>
                    <div className="text-sm text-slate-400">Servers = 10,000 CCU</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Monitoring */}
            <section id="monitoring" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-2">Monitoring</h2>
              <p className="text-slate-400 mb-6">
                Built-in Prometheus metrics for observability.
              </p>

              <CodeBlock code={monitoringSetup} language="yaml" filename="prometheus.yml" />

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-6">
                  <h3 className="font-semibold text-white mb-3">Key Metrics</h3>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between">
                      <span className="text-slate-400">Connected Clients</span>
                      <code className="text-violet-400">gameon_connected_clients</code>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-slate-400">Active Rooms</span>
                      <code className="text-violet-400">gameon_active_rooms</code>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-slate-400">Messages/sec</span>
                      <code className="text-violet-400">gameon_messages_total</code>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-slate-400">Latency</span>
                      <code className="text-violet-400">gameon_latency_ms</code>
                    </li>
                  </ul>
                </div>

                <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-6">
                  <h3 className="font-semibold text-white mb-3">Alerting Recommendations</h3>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li>• Alert when CCU exceeds 80% capacity</li>
                    <li>• Alert on error rate spike (&gt;1%)</li>
                    <li>• Alert on P99 latency &gt; 100ms</li>
                    <li>• Alert on Redis connection failures</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Next Steps */}
            <div className="p-8 rounded-xl bg-gradient-to-r from-violet-900/20 to-fuchsia-900/20 border border-violet-500/20">
              <h3 className="text-xl font-semibold text-white mb-4">Need Help Deploying?</h3>
              <p className="text-slate-400 mb-6">
                Our enterprise plan includes dedicated deployment support and SLA guarantees.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300"
                >
                  View Pricing
                  <ChevronRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300"
                >
                  Contact Sales
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
