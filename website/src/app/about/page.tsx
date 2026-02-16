import Link from "next/link";
import {
  Target,
  Heart,
  Lightbulb,
  Users,
  GraduationCap,
  Gamepad2,
  ArrowRight,
  MapPin,
  Calendar,
  Award
} from "lucide-react";

const values = [
  {
    icon: GraduationCap,
    title: "Education First",
    description: "Every game we build has learning at its core. We believe that play is the most effective teacher, transforming complex subjects into engaging experiences.",
  },
  {
    icon: Heart,
    title: "Student Success",
    description: "Our ultimate measure of success is seeing students genuinely enjoy their educational journey. When learning feels like play, knowledge sticks.",
  },
  {
    icon: Lightbulb,
    title: "Continuous Innovation",
    description: "The intersection of gaming and education evolves rapidly. We stay at the forefront, constantly exploring new ways to make learning more engaging.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description: "We build tools not just for ourselves, but for every educator and developer who shares our vision of making education more engaging through games.",
  },
];

const milestones = [
  {
    year: "2003",
    title: "Historical Conquest Born",
    description: "What started as a college project became the foundation for everything that followed. A simple idea: make history engaging through strategic gameplay.",
  },
  {
    year: "2012",
    title: "Educational Focus",
    description: "After seeing the impact games could have in classrooms, the focus shifted entirely to educational gaming. Schools began adopting Historical Conquest nationwide.",
  },
  {
    year: "2018",
    title: "Digital Transformation",
    description: "Recognizing the shift toward digital learning, Game On Dude! was founded to bring educational games into the digital age while preserving what made physical games special.",
  },
  {
    year: "2023",
    title: "Multiplayer Platform",
    description: "Game On Dude! was created to solve a fundamental problem: making it easy for educational game developers to build connected, real-time experiences.",
  },
  {
    year: "2024",
    title: "Open Platform",
    description: "Game On Dude! launches publicly, offering the same powerful tools used for our games to developers everywhere who share our educational mission.",
  },
];

export default function AboutPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="py-16 lg:py-24 bg-gradient-to-b from-violet-950/30 to-slate-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Making Education an Adventure
            </h1>
            <p className="text-xl text-slate-400">
              Game On Dude! exists to transform how students experience education.
              Through thoughtfully designed games, we turn learning into an engaging
              journey that students actually want to take.
            </p>
          </div>
        </div>
      </section>

      {/* Origin Story */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-white mb-6">Our Story</h2>
              <div className="space-y-4 text-slate-400">
                <p>
                  Over two decades ago, a college project sparked something unexpected.
                  What was meant to be a simple assignment evolved into Historical Conquest,
                  a strategy card game that would go on to become one of the most successful
                  history games in American education.
                </p>
                <p>
                  For twelve years, Zack Edwards worked with students and educators,
                  witnessing firsthand how games could transform reluctant learners into
                  engaged participants. The spark of curiosity that games ignite proved
                  far more powerful than traditional teaching methods.
                </p>
                <p>
                  As education moved digital, it became clear that the future of educational
                  gaming lay in connected experiences. Students wanted to play together,
                  compete, and collaborate. Game On Dude! was born from this realization,
                  bridging the gap between physical and digital educational gaming.
                </p>
                <p>
                  Today, Game On Dude! represents the culmination of this journey—a
                  platform that makes it possible for any developer to create the kind of
                  engaging, educational multiplayer experiences that transform how students learn.
                </p>
              </div>
            </div>
            <div className="relative">
              <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">ZE</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">Zack Edwards</h3>
                    <p className="text-slate-400">Founder & CEO</p>
                  </div>
                </div>
                <blockquote className="text-slate-300 italic mb-6">
                  &ldquo;I&apos;ve spent twelve years watching students transform when
                  learning becomes play. That moment when a reluctant learner suddenly
                  lights up because they&apos;re having fun while learning history or
                  math—that&apos;s what drives everything we do at Game On Dude!.&rdquo;
                </blockquote>
                <div className="flex flex-wrap gap-4 text-sm text-slate-400">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>12+ years in EdTech</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4" />
                    <span>Creator of Historical Conquest</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 lg:py-24 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <Target className="h-12 w-12 text-violet-400 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-white mb-6">Our Mission</h2>
            <p className="text-xl text-slate-400">
              To empower educators and developers with the tools they need to create
              multiplayer games that make learning irresistible. We believe every
              student deserves to experience education as an adventure, not a chore.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {values.map((value) => (
              <div
                key={value.title}
                className="rounded-xl bg-slate-800/50 border border-slate-700 p-6"
              >
                <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
                  <value.icon className="h-6 w-6 text-violet-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{value.title}</h3>
                <p className="text-sm text-slate-400">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white text-center mb-16">Our Journey</h2>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-0 md:left-1/2 top-0 bottom-0 w-px bg-slate-700 transform md:-translate-x-px" />

            <div className="space-y-12">
              {milestones.map((milestone, index) => (
                <div
                  key={milestone.year}
                  className={`relative flex flex-col md:flex-row gap-8 ${
                    index % 2 === 0 ? "md:flex-row-reverse" : ""
                  }`}
                >
                  {/* Content */}
                  <div className="flex-1 md:text-right pl-8 md:pl-0">
                    <div
                      className={`rounded-xl bg-slate-800/50 border border-slate-700 p-6 ${
                        index % 2 === 0 ? "md:mr-8" : "md:ml-8"
                      }`}
                    >
                      <span className="text-violet-400 font-bold">{milestone.year}</span>
                      <h3 className="text-lg font-semibold text-white mt-1 mb-2">
                        {milestone.title}
                      </h3>
                      <p className="text-sm text-slate-400">{milestone.description}</p>
                    </div>
                  </div>

                  {/* Dot */}
                  <div className="absolute left-0 md:left-1/2 w-4 h-4 rounded-full bg-violet-500 border-4 border-slate-950 transform -translate-x-1/2 mt-6" />

                  {/* Spacer for alternating layout */}
                  <div className="hidden md:block flex-1" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 lg:py-24 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-white mb-6">Get in Touch</h2>
              <p className="text-slate-400 mb-8">
                Whether you&apos;re an educator looking to bring games into your classroom,
                a developer wanting to build educational experiences, or just someone who
                shares our passion for learning through play, we&apos;d love to hear from you.
              </p>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                    <MapPin className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">Mailing Address</h3>
                    <p className="text-slate-400">
                      Game On Dude!<br />
                      PO Box 1451<br />
                      Liberty, MO 64068
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                    <Gamepad2 className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">Our Games</h3>
                    <p className="text-slate-400">
                      Lightning Round, TimeQuest, Number Munchers,<br />
                      Panic Attack, Historical Conquest
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500 transition-colors"
                >
                  Contact Us
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-8">
              <h3 className="text-xl font-semibold text-white mb-6">Follow Our Journey</h3>
              <div className="grid grid-cols-2 gap-4">
                <a
                  href="https://www.facebook.com/gameonguygames/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-slate-700/50 p-4 hover:bg-slate-700 transition-colors text-center"
                >
                  <span className="text-white font-medium">Facebook</span>
                </a>
                <a
                  href="https://x.com/Game On Dude!Education"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-slate-700/50 p-4 hover:bg-slate-700 transition-colors text-center"
                >
                  <span className="text-white font-medium">X / Twitter</span>
                </a>
                <a
                  href="https://www.instagram.com/gameonguy_edu/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-slate-700/50 p-4 hover:bg-slate-700 transition-colors text-center"
                >
                  <span className="text-white font-medium">Instagram</span>
                </a>
                <a
                  href="https://www.linkedin.com/company/gameon-guy-inc/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-slate-700/50 p-4 hover:bg-slate-700 transition-colors text-center"
                >
                  <span className="text-white font-medium">LinkedIn</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
