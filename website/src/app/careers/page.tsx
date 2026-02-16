import Link from "next/link";
import { Briefcase, Heart, Lightbulb, Users, Send, ArrowRight } from "lucide-react";

const benefits = [
  {
    icon: Heart,
    title: "Mission-Driven Work",
    description: "Make a real impact on how students experience education. Every line of code helps make learning more engaging.",
  },
  {
    icon: Lightbulb,
    title: "Creative Freedom",
    description: "We encourage innovation and experimentation. If you have an idea that could help students learn better, we want to hear it.",
  },
  {
    icon: Users,
    title: "Collaborative Culture",
    description: "Work with passionate people who care deeply about education and gaming. Small team, big impact.",
  },
];

const values = [
  "We believe learning should be an adventure, not a chore",
  "We value creativity and aren't afraid to try new approaches",
  "We measure success by student engagement and outcomes",
  "We build tools we're proud to put in front of educators",
  "We communicate openly and honestly",
];

export default function CareersPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="py-16 lg:py-24 bg-gradient-to-b from-violet-950/30 to-slate-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Build the Future of Educational Gaming
            </h1>
            <p className="text-xl text-slate-400">
              Join us in creating technology that transforms how students learn.
              We&apos;re on a mission to make education as engaging as the best games.
            </p>
          </div>
        </div>
      </section>

      {/* Why work here */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white text-center mb-12">Why Game On Dude!</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {benefits.map((benefit) => (
              <div
                key={benefit.title}
                className="rounded-xl bg-slate-800/50 border border-slate-700 p-8"
              >
                <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-6">
                  <benefit.icon className="h-6 w-6 text-violet-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{benefit.title}</h3>
                <p className="text-slate-400">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 lg:py-24 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-white mb-6">What We Believe</h2>
              <p className="text-slate-400 mb-8">
                Our values guide every decision we make, from product features to how
                we work together as a team.
              </p>
              <ul className="space-y-4">
                {values.map((value, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-violet-400 text-sm font-medium">{index + 1}</span>
                    </div>
                    <span className="text-slate-300">{value}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-8">
              <h3 className="text-xl font-semibold text-white mb-4">Our Tech Stack</h3>
              <p className="text-slate-400 mb-6">
                We use modern tools that let us move fast without compromising quality.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "TypeScript",
                  "Node.js",
                  "React",
                  "Next.js",
                  "Unity",
                  "C#",
                  "PostgreSQL",
                  "Redis",
                  "WebSocket",
                  "Docker",
                  "AWS",
                ].map((tech) => (
                  <span
                    key={tech}
                    className="px-3 py-1.5 rounded-full bg-slate-700 text-slate-300 text-sm"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Open positions */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white text-center mb-6">Open Positions</h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            We&apos;re not actively hiring at the moment, but we&apos;re always interested
            in connecting with talented people who share our mission.
          </p>

          {/* No open positions */}
          <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-12 text-center">
            <Briefcase className="h-12 w-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Open Positions</h3>
            <p className="text-slate-400 mb-6">
              Check back later or reach out to introduce yourself.
              Great people are always welcome.
            </p>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 lg:py-24 bg-slate-900/50">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/30 p-8 md:p-12 text-center">
            <Send className="h-10 w-10 text-violet-400 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-white mb-4">
              Interested in Joining Us?
            </h2>
            <p className="text-slate-400 mb-8 max-w-xl mx-auto">
              Even without open positions, we love hearing from people passionate about
              educational gaming. Tell us about yourself and what excites you about
              our mission.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500 transition-colors"
            >
              Get in Touch
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
