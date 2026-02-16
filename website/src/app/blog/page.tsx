import Link from "next/link";
import { PenLine, Bell, ArrowRight } from "lucide-react";

export default function BlogPage() {
  return (
    <div className="pt-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <div className="text-center">
          {/* Icon */}
          <div className="w-20 h-20 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-8">
            <PenLine className="h-10 w-10 text-violet-400" />
          </div>

          {/* Heading */}
          <h1 className="text-4xl font-bold text-white mb-4">Blog Coming Soon</h1>
          <p className="text-xl text-slate-400 mb-8 max-w-2xl mx-auto">
            We&apos;re preparing articles about educational game development, multiplayer
            architecture, and the intersection of learning and play. Check back soon for
            insights from the Game On Dude! team.
          </p>

          {/* What to expect */}
          <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-8 mb-12 text-left">
            <h2 className="text-lg font-semibold text-white mb-6">What to Expect</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="text-violet-400 mt-1">•</span>
                  <div>
                    <h3 className="font-medium text-white">Technical Deep Dives</h3>
                    <p className="text-sm text-slate-400">
                      Explorations of multiplayer architecture, netcode optimization,
                      and real-time state synchronization.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-violet-400 mt-1">•</span>
                  <div>
                    <h3 className="font-medium text-white">Game Design Insights</h3>
                    <p className="text-sm text-slate-400">
                      How we design games that make learning engaging without
                      sacrificing educational value.
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="text-violet-400 mt-1">•</span>
                  <div>
                    <h3 className="font-medium text-white">Case Studies</h3>
                    <p className="text-sm text-slate-400">
                      Stories from classrooms and developers using Game On Dude!
                      to create impactful learning experiences.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-violet-400 mt-1">•</span>
                  <div>
                    <h3 className="font-medium text-white">Product Updates</h3>
                    <p className="text-sm text-slate-400">
                      Announcements about new features, SDK updates, and platform
                      improvements.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stay updated */}
          <div className="rounded-2xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/30 p-8">
            <Bell className="h-8 w-8 text-violet-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Stay Updated</h2>
            <p className="text-slate-400 mb-6">
              Follow us on social media to be notified when we publish new content.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <a
                href="https://x.com/GameOnGuyEdu"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-600 transition-colors"
              >
                Follow on X
              </a>
              <a
                href="https://www.linkedin.com/company/gameon-guy-inc/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-600 transition-colors"
              >
                Follow on LinkedIn
              </a>
            </div>
          </div>

          {/* Other resources */}
          <div className="mt-12 pt-12 border-t border-slate-800">
            <h2 className="text-lg font-semibold text-white mb-6">In the Meantime</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <Link
                href="/docs"
                className="rounded-xl bg-slate-800/50 border border-slate-700 p-6 hover:border-violet-500/50 transition-colors text-left"
              >
                <h3 className="font-medium text-white mb-2">Documentation</h3>
                <p className="text-sm text-slate-400 mb-3">
                  Learn how to build multiplayer games with our comprehensive guides.
                </p>
                <span className="inline-flex items-center gap-1 text-sm text-violet-400">
                  Read docs <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
              <Link
                href="/docs/examples"
                className="rounded-xl bg-slate-800/50 border border-slate-700 p-6 hover:border-violet-500/50 transition-colors text-left"
              >
                <h3 className="font-medium text-white mb-2">Code Examples</h3>
                <p className="text-sm text-slate-400 mb-3">
                  Working code samples for common multiplayer game patterns.
                </p>
                <span className="inline-flex items-center gap-1 text-sm text-violet-400">
                  View examples <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
              <Link
                href="/changelog"
                className="rounded-xl bg-slate-800/50 border border-slate-700 p-6 hover:border-violet-500/50 transition-colors text-left"
              >
                <h3 className="font-medium text-white mb-2">Changelog</h3>
                <p className="text-sm text-slate-400 mb-3">
                  See what&apos;s new in the latest version of Game On Dude!.
                </p>
                <span className="inline-flex items-center gap-1 text-sm text-violet-400">
                  View updates <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
