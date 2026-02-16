"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Zap,
  Shield,
  Globe,
  Code,
  Server,
  Gamepad2,
  ArrowRight,
  Check,
  Terminal
} from "lucide-react";
import {
  AnimatedSection,
  StaggerContainer,
  StaggerItem,
  HoverCard,
  FadeIn,
  SlideIn,
} from "@/components/AnimatedSection";

const features = [
  {
    name: "Client-Side Prediction",
    description: "Instant player feedback with automatic server reconciliation. Your game feels responsive even with 200ms latency.",
    icon: Zap,
  },
  {
    name: "Lag Compensation",
    description: "Server-side hit detection that rewinds time to validate shots at the moment players fired. Fair gameplay for everyone.",
    icon: Shield,
  },
  {
    name: "Horizontal Scaling",
    description: "Redis-powered room synchronization across multiple servers. Scale to millions of concurrent users.",
    icon: Globe,
  },
  {
    name: "Unity SDK",
    description: "Drop-in replacement for Photon PUN. Migrate your existing game with minimal code changes.",
    icon: Gamepad2,
  },
  {
    name: "PostgreSQL & Redis",
    description: "Built-in database integration for user accounts, match history, leaderboards, and real-time caching.",
    icon: Server,
  },
  {
    name: "TypeScript First",
    description: "Fully typed APIs with excellent IDE support. Catch bugs before they reach production.",
    icon: Code,
  },
];

const gameTypes = [
  { name: "Trivia Games", description: "Lightning Round, TimeQuest", color: "from-violet-500 to-purple-500" },
  { name: "Real-Time Movement", description: "Number Munchers, Panic Attack", color: "from-blue-500 to-cyan-500" },
  { name: "Turn-Based", description: "Historical Conquest, Card Games", color: "from-emerald-500 to-teal-500" },
];

const stats = [
  { value: "199+", label: "Unit Tests" },
  { value: "<5ms", label: "Avg Latency" },
  { value: "60Hz", label: "Tick Rate" },
  { value: "100%", label: "TypeScript" },
];

export default function HomePage() {
  return (
    <div className="relative">
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-violet-950/50 via-slate-950 to-slate-950" />
        <motion.div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-violet-500/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.2, 0.3, 0.2],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <FadeIn delay={0.1}>
              <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-4 py-1.5 text-sm text-violet-400 ring-1 ring-violet-500/20 mb-8">
                <Zap className="h-4 w-4" />
                <span>Now with Netcode Module - Prediction, Lag Comp, Interpolation</span>
              </div>
            </FadeIn>

            <SlideIn direction="up" delay={0.2}>
              <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight">
                <span className="text-white">Build Multiplayer Games</span>
                <br />
                <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
                  Without the Headaches
                </span>
              </h1>
            </SlideIn>

            <SlideIn direction="up" delay={0.3}>
              <p className="mt-6 text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto">
                Game On Dude! is a production-ready game server platform with client-side prediction,
                lag compensation, and horizontal scaling. No per-user fees. Full control over your networking.
              </p>
            </SlideIn>

            <SlideIn direction="up" delay={0.4}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Link
                    href="/docs/getting-started"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg hover:from-violet-500 hover:to-fuchsia-500 transition-all"
                  >
                    Get Started Free
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </motion.div>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Link
                    href="/docs"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-8 py-3.5 text-base font-semibold text-white ring-1 ring-white/10 hover:bg-white/10 transition-all"
                  >
                    View Documentation
                  </Link>
                </motion.div>
              </div>
            </SlideIn>

            {/* Stats */}
            <StaggerContainer className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto" staggerDelay={0.1}>
              {stats.map((stat) => (
                <StaggerItem key={stat.label}>
                  <div className="text-center">
                    <motion.div
                      className="text-3xl font-bold text-white"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, delay: 0.5 }}
                    >
                      {stat.value}
                    </motion.div>
                    <div className="text-sm text-slate-400 mt-1">{stat.label}</div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>

          {/* Code preview */}
          <AnimatedSection delay={0.6} className="mt-20 relative">
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent z-10 pointer-events-none" />
            <motion.div
              className="rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden"
              whileHover={{ y: -5 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/50 border-b border-slate-700">
                <div className="flex gap-1.5">
                  <motion.div
                    className="w-3 h-3 rounded-full bg-red-500"
                    whileHover={{ scale: 1.2 }}
                  />
                  <motion.div
                    className="w-3 h-3 rounded-full bg-yellow-500"
                    whileHover={{ scale: 1.2 }}
                  />
                  <motion.div
                    className="w-3 h-3 rounded-full bg-green-500"
                    whileHover={{ scale: 1.2 }}
                  />
                </div>
                <div className="flex items-center gap-2 ml-4 text-sm text-slate-400">
                  <Terminal className="h-4 w-4" />
                  server.ts
                </div>
              </div>
              <pre className="p-6 text-sm overflow-x-auto">
                <code className="text-slate-300">
{`import { GameOnServer, LightningRoundRoom } from 'gameon-multiplayer';

// Create server
const server = new GameOnServer({ port: 3000 });

// Register your game
server.roomManager.registerGame('lightning_round', LightningRoundRoom, {
  minPlayers: 2,
  maxPlayers: 8,
  tickRate: 20,
});

// Start server
await server.start();
console.log('Game server running on port 3000');`}
                </code>
              </pre>
            </motion.div>
          </AnimatedSection>
        </div>
      </section>

      {/* Game Types Section */}
      <section className="py-20 lg:py-32 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Built for Every Game Type
            </h2>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
              Pre-built room types for common multiplayer patterns. Extend them or build your own.
            </p>
          </AnimatedSection>

          <StaggerContainer className="grid md:grid-cols-3 gap-6" staggerDelay={0.15}>
            {gameTypes.map((type) => (
              <StaggerItem key={type.name}>
                <HoverCard>
                  <div className="relative group rounded-2xl bg-slate-800/50 border border-slate-700 p-8 hover:border-slate-600 transition-all">
                    <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${type.color} flex items-center justify-center mb-4`}>
                      <Gamepad2 className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">{type.name}</h3>
                    <p className="text-slate-400">{type.description}</p>
                  </div>
                </HoverCard>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Everything You Need for Multiplayer
            </h2>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
              Professional-grade netcode, database integration, and monitoring - all included.
            </p>
          </AnimatedSection>

          <StaggerContainer className="grid md:grid-cols-2 lg:grid-cols-3 gap-8" staggerDelay={0.1}>
            {features.map((feature) => (
              <StaggerItem key={feature.name}>
                <HoverCard>
                  <div className="relative rounded-2xl bg-slate-900/50 border border-slate-800 p-8 hover:border-violet-500/50 transition-all h-full">
                    <motion.div
                      className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4"
                      whileHover={{ rotate: 5, scale: 1.1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <feature.icon className="h-6 w-6 text-violet-400" />
                    </motion.div>
                    <h3 className="text-xl font-semibold text-white mb-2">{feature.name}</h3>
                    <p className="text-slate-400">{feature.description}</p>
                  </div>
                </HoverCard>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Why Game On Section */}
      <section className="py-20 lg:py-32 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <AnimatedSection direction="left">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
                Why Choose Game On Dude!?
              </h2>
              <p className="text-lg text-slate-400 mb-8">
                Stop paying per-user fees to Photon or fighting with Colyseus quirks.
                Own your infrastructure and scale without limits.
              </p>

              <ul className="space-y-4">
                {[
                  "No per-CCU pricing - pay only for servers you use",
                  "Full source code access - customize anything",
                  "Drop-in Unity SDK replacement for Photon PUN",
                  "Production-ready with 199+ unit tests",
                  "Built-in PostgreSQL and Redis integration",
                  "Prometheus-compatible metrics for monitoring",
                ].map((item, index) => (
                  <motion.li
                    key={item}
                    className="flex items-start gap-3"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center mt-0.5">
                      <Check className="h-3 w-3 text-emerald-400" />
                    </div>
                    <span className="text-slate-300">{item}</span>
                  </motion.li>
                ))}
              </ul>

              <motion.div
                className="mt-10"
                whileHover={{ x: 5 }}
                transition={{ duration: 0.2 }}
              >
                <Link
                  href="/features"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300 font-medium transition-colors"
                >
                  Explore all features
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </motion.div>
            </AnimatedSection>

            <AnimatedSection direction="right">
              <motion.div
                className="rounded-2xl bg-slate-800 border border-slate-700 p-8"
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.3 }}
              >
                <h3 className="text-lg font-semibold text-white mb-6">Cost Comparison (1000 CCU)</h3>
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">Photon PUN</span>
                      <span className="text-red-400">$95/month + overage</span>
                    </div>
                    <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-red-500 rounded-full"
                        initial={{ width: 0 }}
                        whileInView={{ width: "90%" }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, delay: 0.2 }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">Game On Dude!</span>
                      <span className="text-emerald-400">~$20/month (server costs)</span>
                    </div>
                    <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-emerald-500 rounded-full"
                        initial={{ width: 0 }}
                        whileInView={{ width: "20%" }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, delay: 0.4 }}
                      />
                    </div>
                  </div>
                </div>
                <p className="mt-6 text-sm text-slate-500">
                  * Estimates based on typical usage. Your actual costs may vary based on infrastructure choices.
                </p>
              </motion.div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <AnimatedSection>
            <motion.div
              className="relative rounded-3xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-16 sm:px-16 sm:py-24 overflow-hidden"
              whileHover={{ scale: 1.01 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
                animate={{
                  backgroundPosition: ["0px 0px", "60px 60px"],
                }}
                transition={{
                  duration: 20,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
              <div className="relative text-center">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                  Ready to Build Your Multiplayer Game?
                </h2>
                <p className="text-lg text-white/80 max-w-2xl mx-auto mb-10">
                  Get started in minutes with our comprehensive documentation and Unity SDK.
                  No credit card required.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Link
                      href="/docs/getting-started"
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white px-8 py-3.5 text-base font-semibold text-violet-600 shadow-lg hover:bg-slate-100 transition-all"
                    >
                      Start Building
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Link
                      href="/contact"
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-8 py-3.5 text-base font-semibold text-white ring-1 ring-white/20 hover:bg-white/20 transition-all"
                    >
                      Talk to Sales
                    </Link>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}
