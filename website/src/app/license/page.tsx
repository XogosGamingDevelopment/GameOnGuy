import Link from "next/link";
import { Scale, FileCode, Check, AlertTriangle } from "lucide-react";

export default function LicensePage() {
  return (
    <div className="pt-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Scale className="h-7 w-7 text-violet-400" />
          </div>
          <div>
            <h1 className="text-4xl font-bold text-white">License</h1>
            <p className="text-slate-400">MIT License</p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-6">
            <h2 className="text-lg font-semibold text-emerald-400 mb-4 flex items-center gap-2">
              <Check className="h-5 w-5" />
              What You Can Do
            </h2>
            <ul className="space-y-2 text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Use for commercial projects
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Modify and customize the code
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Distribute your modifications
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Use in private or proprietary software
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Sublicense to others
              </li>
            </ul>
          </div>

          <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-6">
            <h2 className="text-lg font-semibold text-yellow-400 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Requirements
            </h2>
            <ul className="space-y-2 text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-yellow-400 mt-1">!</span>
                Include the original copyright notice
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-400 mt-1">!</span>
                Include the license text in distributions
              </li>
            </ul>

            <h2 className="text-lg font-semibold text-slate-500 mt-6 mb-4">Limitations</h2>
            <ul className="space-y-2 text-slate-400">
              <li className="flex items-start gap-2">
                <span className="text-slate-500 mt-1">×</span>
                No warranty or liability guarantees
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-500 mt-1">×</span>
                Authors are not liable for damages
              </li>
            </ul>
          </div>
        </div>

        {/* Full License */}
        <div className="rounded-xl bg-slate-800/50 border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50">
            <div className="flex items-center gap-2 text-slate-400">
              <FileCode className="h-4 w-4" />
              <span className="text-sm font-medium">MIT License</span>
            </div>
          </div>
          <div className="p-6">
            <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
{`MIT License

Copyright (c) 2024 Game On Dude!, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`}
            </pre>
          </div>
        </div>

        {/* Why MIT */}
        <div className="mt-12 rounded-xl bg-slate-800/50 border border-slate-700 p-8">
          <h2 className="text-2xl font-semibold text-white mb-4">Why We Chose MIT</h2>
          <div className="space-y-4 text-slate-300">
            <p>
              We selected the MIT License for Game On Dude! because we believe in the
              power of open collaboration. The MIT License is one of the most permissive
              and widely-understood open source licenses, making it easy for developers
              to use our platform without legal concerns.
            </p>
            <p>
              Our mission is to help developers create educational games. The MIT License
              removes barriers and allows you to focus on what matters: building great
              multiplayer experiences for learners.
            </p>
            <p>
              Whether you&apos;re building a free educational tool for classrooms or a
              commercial game for app stores, the MIT License gives you the freedom to
              do so without restrictions.
            </p>
          </div>
        </div>

        {/* Third-party licenses */}
        <div className="mt-12">
          <h2 className="text-2xl font-semibold text-white mb-6">Third-Party Licenses</h2>
          <p className="text-slate-400 mb-6">
            Game On Dude! includes the following open source dependencies:
          </p>
          <div className="rounded-xl bg-slate-800/50 border border-slate-700 divide-y divide-slate-700">
            {[
              { name: "ws", license: "MIT", description: "WebSocket implementation for Node.js" },
              { name: "uuid", license: "MIT", description: "UUID generation" },
              { name: "ioredis", license: "MIT", description: "Redis client for Node.js" },
              { name: "pg", license: "MIT", description: "PostgreSQL client for Node.js" },
              { name: "prom-client", license: "Apache-2.0", description: "Prometheus metrics client" },
            ].map((dep) => (
              <div key={dep.name} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">{dep.name}</p>
                  <p className="text-sm text-slate-400">{dep.description}</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-slate-700 text-slate-300">
                  {dep.license}
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-500 mt-4">
            For a complete list of dependencies and their licenses, see the package.json
            file in the repository.
          </p>
        </div>

        {/* Questions */}
        <div className="mt-12 p-8 rounded-xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/30">
          <h2 className="text-xl font-semibold text-white mb-4">Questions About Licensing?</h2>
          <p className="text-slate-400 mb-6">
            If you have questions about using Game On Dude! in your project or need
            clarification about the license terms, we&apos;re here to help.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500 transition-colors"
          >
            Contact Us
          </Link>
        </div>
      </div>
    </div>
  );
}
