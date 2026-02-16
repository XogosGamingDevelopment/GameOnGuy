import Link from "next/link";
import { Check, ArrowRight, HelpCircle } from "lucide-react";

const tiers = [
  {
    name: "Open Source",
    price: "Free",
    description: "Self-hosted, full source code access",
    features: [
      "Full source code access",
      "All core features included",
      "Community support (GitHub)",
      "Unity SDK included",
      "PostgreSQL & Redis integration",
      "Unlimited concurrent users",
      "Docker & AWS deployment configs",
    ],
    cta: "Get Started",
    href: "/docs/getting-started",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$99",
    period: "/month",
    description: "For teams who need priority support",
    features: [
      "Everything in Open Source",
      "Priority email support",
      "Private Discord channel",
      "Architecture review (1 session/month)",
      "Early access to new features",
      "Custom integration assistance",
      "SLA: 24-hour response time",
    ],
    cta: "Start Pro Trial",
    href: "/contact?plan=pro",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For large-scale deployments",
    features: [
      "Everything in Pro",
      "Dedicated support engineer",
      "Custom feature development",
      "On-premise deployment support",
      "Security audit & compliance",
      "Training & onboarding",
      "SLA: 4-hour response time",
    ],
    cta: "Contact Sales",
    href: "/contact?plan=enterprise",
    highlighted: false,
  },
];

const faqs = [
  {
    question: "Is the open source version really free?",
    answer:
      "Yes! The entire Game On Dude! server is open source under the MIT license. You can use it for any project, commercial or otherwise, without paying us anything. You only pay for your own server infrastructure (AWS, DigitalOcean, etc.).",
  },
  {
    question: "What's included in 'priority support'?",
    answer:
      "Pro subscribers get direct email access to our engineering team with guaranteed 24-hour response times. You also get a private Discord channel for real-time discussions and one architecture review session per month where we help optimize your game's networking.",
  },
  {
    question: "Can I upgrade or downgrade at any time?",
    answer:
      "Absolutely. You can upgrade from Open Source to Pro instantly, and downgrade at any time. Enterprise contracts are annual but can be adjusted based on your needs.",
  },
  {
    question: "Do you offer managed hosting?",
    answer:
      "Not currently, but we provide comprehensive deployment guides for AWS, DigitalOcean, and Docker. Enterprise customers can get hands-on deployment assistance as part of their package.",
  },
  {
    question: "How does this compare to Photon pricing?",
    answer:
      "Photon charges per concurrent user (CCU). At 1,000 CCU, you'd pay around $95/month plus overage fees. With Game On, you pay only for your server infrastructure - typically $20-50/month for the same capacity. At scale, the savings are even more significant.",
  },
  {
    question: "What if I need a feature that doesn't exist?",
    answer:
      "For Open Source users, you can submit feature requests on GitHub or contribute directly. Pro users get priority consideration for feature requests. Enterprise customers can commission custom feature development.",
  },
];

export default function PricingPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Simple, Transparent Pricing
            </h1>
            <p className="text-xl text-slate-400">
              Start free with our open source version. Upgrade for priority support and enterprise features.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-3 gap-8">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl p-8 ${
                  tier.highlighted
                    ? "bg-gradient-to-b from-violet-600/20 to-fuchsia-600/20 border-2 border-violet-500"
                    : "bg-slate-800/50 border border-slate-700"
                }`}
              >
                {tier.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-semibold px-4 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-white mb-2">{tier.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">{tier.price}</span>
                    {tier.period && <span className="text-slate-400">{tier.period}</span>}
                  </div>
                  <p className="text-slate-400 mt-2">{tier.description}</p>
                </div>

                <ul className="space-y-4 mb-8">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span className="text-slate-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.href}
                  className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-base font-semibold transition-all ${
                    tier.highlighted
                      ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
                      : "bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10"
                  }`}
                >
                  {tier.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cost Comparison */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Save Money at Scale</h2>
            <p className="text-lg text-slate-400">
              Compare monthly costs at different concurrent user levels
            </p>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="rounded-2xl bg-slate-800/50 border border-slate-700 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-800">
                    <th className="text-left py-4 px-6 text-slate-400 font-medium">CCU</th>
                    <th className="text-center py-4 px-6 text-slate-400 font-medium">Photon PUN</th>
                    <th className="text-center py-4 px-6 text-violet-400 font-semibold">
                      Game On (Est. Server Costs)
                    </th>
                    <th className="text-center py-4 px-6 text-emerald-400 font-medium">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { ccu: "100", photon: "$19", gameon: "~$10", savings: "47%" },
                    { ccu: "500", photon: "$75", gameon: "~$15", savings: "80%" },
                    { ccu: "1,000", photon: "$95+", gameon: "~$20", savings: "79%" },
                    { ccu: "5,000", photon: "$375+", gameon: "~$50", savings: "87%" },
                    { ccu: "10,000", photon: "$750+", gameon: "~$100", savings: "87%" },
                    { ccu: "50,000", photon: "Contact", gameon: "~$400", savings: "90%+" },
                  ].map((row) => (
                    <tr key={row.ccu} className="border-t border-slate-700">
                      <td className="py-4 px-6 text-white font-medium">{row.ccu}</td>
                      <td className="py-4 px-6 text-center text-red-400">{row.photon}</td>
                      <td className="py-4 px-6 text-center text-emerald-400">{row.gameon}</td>
                      <td className="py-4 px-6 text-center text-emerald-400 font-semibold">
                        {row.savings}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-slate-500 mt-4 text-center">
              * Game On server costs are estimates based on AWS EC2/Fargate pricing. Actual costs depend on
              your infrastructure choices.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 lg:py-24 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Frequently Asked Questions</h2>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-6">
              {faqs.map((faq) => (
                <div
                  key={faq.question}
                  className="rounded-xl bg-slate-800/50 border border-slate-700 p-6"
                >
                  <h3 className="flex items-start gap-3 text-lg font-semibold text-white mb-3">
                    <HelpCircle className="h-5 w-5 text-violet-400 flex-shrink-0 mt-0.5" />
                    {faq.question}
                  </h3>
                  <p className="text-slate-400 ml-8">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Still Have Questions?</h2>
          <p className="text-lg text-slate-400 mb-8 max-w-2xl mx-auto">
            Our team is happy to help you choose the right plan for your needs.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg hover:from-violet-500 hover:to-fuchsia-500 transition-all"
          >
            Contact Us
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
