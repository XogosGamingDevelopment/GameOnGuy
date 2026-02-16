import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Settings,
  Gamepad2,
  Network,
  Zap,
  ChevronRight,
  Copy,
  Check,
  Package,
} from "lucide-react";

const installMethods = [
  {
    name: "Unity Package Manager (Recommended)",
    description: "Install via Git URL in Unity Package Manager",
    steps: [
      "Open Unity and go to Window → Package Manager",
      "Click the + button and select \"Add package from git URL\"",
      "Enter: https://github.com/gameon-guy/unity-sdk.git",
      "Click Add and wait for installation",
    ],
    icon: Package,
  },
  {
    name: "Manual Installation",
    description: "Download and import the Unity package",
    steps: [
      "Download the latest .unitypackage from GitHub Releases",
      "In Unity, go to Assets → Import Package → Custom Package",
      "Select the downloaded file and import all assets",
    ],
    icon: Download,
  },
];

const components = [
  {
    name: "GameOnNetworkManager",
    description: "Core component for managing server connections and rooms.",
    properties: [
      { name: "serverUrl", type: "string", description: "WebSocket server URL" },
      { name: "autoConnect", type: "bool", description: "Connect on Start()" },
      { name: "reconnectAttempts", type: "int", description: "Max reconnection attempts" },
    ],
    events: [
      { name: "OnConnected", description: "Fired when connected to server" },
      { name: "OnDisconnected", description: "Fired when disconnected" },
      { name: "OnRoomJoined", description: "Fired when joined a room" },
      { name: "OnRoomLeft", description: "Fired when left a room" },
      { name: "OnError", description: "Fired on connection errors" },
    ],
    example: `using GameOn.Multiplayer;
using UnityEngine;

public class GameManager : MonoBehaviour
{
    [SerializeField] private GameOnNetworkManager networkManager;

    async void Start()
    {
        networkManager.OnConnected += () => Debug.Log("Connected!");
        networkManager.OnRoomJoined += OnRoomJoined;

        await networkManager.Connect();
    }

    async void JoinGame()
    {
        await networkManager.JoinOrCreate("trivia", new {
            username = "Player1",
            team = "blue"
        });
    }

    void OnRoomJoined(Room room)
    {
        Debug.Log($"Joined room: {room.Id}");

        room.OnStateChange += (state) => {
            // Update game UI based on state
            UpdateUI(state);
        };

        room.OnMessage<ChatMessage>("chat", (msg) => {
            chatUI.AddMessage(msg.from, msg.text);
        });
    }
}`,
  },
  {
    name: "GameOnTriviaManager",
    description: "Specialized component for trivia game functionality.",
    properties: [
      { name: "networkManager", type: "GameOnNetworkManager", description: "Reference to network manager" },
      { name: "questionTimeLimit", type: "float", description: "Seconds per question" },
    ],
    events: [
      { name: "OnQuestionReceived", description: "New question from server" },
      { name: "OnAnswerResult", description: "Result of submitted answer" },
      { name: "OnScoresUpdated", description: "Scores changed" },
      { name: "OnGameEnded", description: "Game finished" },
    ],
    example: `using GameOn.Multiplayer;
using UnityEngine;
using UnityEngine.UI;

public class TriviaGameUI : MonoBehaviour
{
    [SerializeField] private GameOnTriviaManager triviaManager;
    [SerializeField] private Text questionText;
    [SerializeField] private Button[] answerButtons;

    void OnEnable()
    {
        triviaManager.OnQuestionReceived += DisplayQuestion;
        triviaManager.OnAnswerResult += ShowResult;
        triviaManager.OnScoresUpdated += UpdateScoreboard;
    }

    void DisplayQuestion(TriviaQuestion question)
    {
        questionText.text = question.text;

        for (int i = 0; i < answerButtons.Length; i++)
        {
            int index = i;
            answerButtons[i].GetComponentInChildren<Text>().text =
                question.answers[i];
            answerButtons[i].onClick.AddListener(() =>
                triviaManager.SubmitAnswer(index));
        }
    }

    void ShowResult(AnswerResult result)
    {
        if (result.correct)
            Debug.Log($"Correct! +{result.points} points");
        else
            Debug.Log($"Wrong! Correct answer: {result.correctAnswer}");
    }
}`,
  },
  {
    name: "NetworkTransform",
    description: "Automatically sync transform between clients with interpolation.",
    properties: [
      { name: "syncPosition", type: "bool", description: "Sync position" },
      { name: "syncRotation", type: "bool", description: "Sync rotation" },
      { name: "syncScale", type: "bool", description: "Sync scale" },
      { name: "interpolationSpeed", type: "float", description: "Smoothing factor" },
      { name: "sendRate", type: "float", description: "Updates per second" },
    ],
    events: [],
    example: `// Simply add NetworkTransform component to your GameObject
// Configure in Inspector or via code:

using GameOn.Multiplayer;
using UnityEngine;

public class PlayerController : MonoBehaviour
{
    private NetworkTransform netTransform;

    void Awake()
    {
        netTransform = GetComponent<NetworkTransform>();
        netTransform.syncPosition = true;
        netTransform.syncRotation = true;
        netTransform.interpolationSpeed = 10f;
        netTransform.sendRate = 20f; // 20 updates/sec
    }

    void Update()
    {
        if (netTransform.IsOwner)
        {
            // Only owner can move
            float h = Input.GetAxis("Horizontal");
            float v = Input.GetAxis("Vertical");
            transform.Translate(new Vector3(h, 0, v) * Time.deltaTime * 5f);
        }
        // Other clients automatically receive interpolated updates
    }
}`,
  },
];

const migrationSteps = [
  {
    photon: "PhotonNetwork.ConnectUsingSettings()",
    gameon: "await networkManager.Connect()",
    note: "GameOn uses async/await for all network operations",
  },
  {
    photon: "PhotonNetwork.JoinOrCreateRoom(\"room\", options, lobby)",
    gameon: "await networkManager.JoinOrCreate(\"room\", options)",
    note: "Simplified API without lobby system",
  },
  {
    photon: "[PunRPC] void MyRPC()",
    gameon: "room.OnMessage<T>(\"type\", handler)",
    note: "Message-based instead of RPC attributes",
  },
  {
    photon: "PhotonView.IsMine",
    gameon: "networkTransform.IsOwner",
    note: "Ownership works similarly",
  },
  {
    photon: "PhotonNetwork.CurrentRoom.PlayerCount",
    gameon: "room.State.players.Count",
    note: "Access through synchronized state",
  },
];

function CodeBlock({ code, language = "csharp" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 overflow-x-auto text-sm">
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

export default function UnitySDKPage() {
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
                  Unity SDK
                </p>
                <a
                  href="#installation"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Installation
                </a>
                <a
                  href="#components"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  Components
                </a>
                <a
                  href="#migration"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <Zap className="h-4 w-4" />
                  Migration Guide
                </a>
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <div className="mb-12">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
                  <Gamepad2 className="h-6 w-6 text-violet-400" />
                </div>
                <div>
                  <h1 className="text-4xl font-bold text-white">Unity SDK</h1>
                  <p className="text-slate-400">v1.0.0</p>
                </div>
              </div>
              <p className="text-xl text-slate-400">
                Integrate Game On Dude! into your Unity project with our official SDK.
              </p>
            </div>

            {/* Installation */}
            <section id="installation" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-6">Installation</h2>

              <div className="grid md:grid-cols-2 gap-6 mb-8">
                {installMethods.map((method) => (
                  <div
                    key={method.name}
                    className="rounded-xl bg-slate-800/30 border border-slate-700 p-6"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                        <method.icon className="h-5 w-5 text-violet-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{method.name}</h3>
                        <p className="text-sm text-slate-400">{method.description}</p>
                      </div>
                    </div>
                    <ol className="space-y-2">
                      {method.steps.map((step, idx) => (
                        <li key={idx} className="flex gap-3 text-sm">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs">
                            {idx + 1}
                          </span>
                          <span className="text-slate-300">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-6">
                <h3 className="font-semibold text-white mb-4">Requirements</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    Unity 2021.3 LTS or newer
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    .NET Standard 2.1 or .NET 4.x
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    WebSocket support (included in Unity)
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    Newtonsoft.Json (included with SDK)
                  </li>
                </ul>
              </div>
            </section>

            {/* Components */}
            <section id="components" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-6">Components</h2>

              <div className="space-y-8">
                {components.map((component) => (
                  <div
                    key={component.name}
                    className="rounded-xl bg-slate-800/30 border border-slate-700 overflow-hidden"
                  >
                    <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50">
                      <h3 className="text-lg font-mono font-semibold text-white mb-1">
                        {component.name}
                      </h3>
                      <p className="text-slate-400 text-sm">{component.description}</p>
                    </div>

                    <div className="p-6 space-y-6">
                      {component.properties.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                            Properties
                          </p>
                          <div className="space-y-2">
                            {component.properties.map((prop) => (
                              <div key={prop.name} className="flex items-start gap-4 text-sm">
                                <code className="flex-shrink-0 text-violet-400 font-mono">
                                  {prop.name}
                                </code>
                                <span className="text-slate-500">({prop.type})</span>
                                <span className="text-slate-300">{prop.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {component.events.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                            Events
                          </p>
                          <div className="space-y-2">
                            {component.events.map((event) => (
                              <div key={event.name} className="flex items-start gap-4 text-sm">
                                <code className="flex-shrink-0 text-emerald-400 font-mono">
                                  {event.name}
                                </code>
                                <span className="text-slate-300">{event.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                          Example
                        </p>
                        <CodeBlock code={component.example} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Migration Guide */}
            <section id="migration" className="mb-16">
              <h2 className="text-2xl font-bold text-white mb-2">Migration from Photon</h2>
              <p className="text-slate-400 mb-6">
                Switching from Photon? Here&apos;s a quick reference for equivalent APIs.
              </p>

              <div className="rounded-xl bg-slate-800/30 border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-800/50">
                        <th className="text-left px-6 py-3 text-slate-400 font-medium">Photon</th>
                        <th className="text-left px-6 py-3 text-slate-400 font-medium">GameOn</th>
                        <th className="text-left px-6 py-3 text-slate-400 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {migrationSteps.map((step, idx) => (
                        <tr key={idx} className="border-b border-slate-700/50 last:border-0">
                          <td className="px-6 py-4">
                            <code className="text-orange-400 font-mono text-xs">{step.photon}</code>
                          </td>
                          <td className="px-6 py-4">
                            <code className="text-violet-400 font-mono text-xs">{step.gameon}</code>
                          </td>
                          <td className="px-6 py-4 text-slate-400">{step.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <p className="text-yellow-400 text-sm">
                  <strong>Note:</strong> While GameOn provides similar functionality to Photon, the APIs
                  are designed differently. We recommend reviewing the full documentation rather than
                  doing a 1:1 port.
                </p>
              </div>
            </section>

            {/* Next Steps */}
            <div className="p-8 rounded-xl bg-gradient-to-r from-violet-900/20 to-fuchsia-900/20 border border-violet-500/20">
              <h3 className="text-xl font-semibold text-white mb-4">Ready to Build?</h3>
              <p className="text-slate-400 mb-6">
                Check out our tutorials for building complete multiplayer games with Unity.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/docs/guides/trivia-game"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300"
                >
                  Build a Trivia Game
                  <ChevronRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/docs/api"
                  className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300"
                >
                  Server API Reference
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
