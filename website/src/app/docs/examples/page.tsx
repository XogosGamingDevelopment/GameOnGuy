import Link from "next/link";
import { ArrowLeft, ArrowRight, Code, Gamepad2, Trophy, Swords, Brain, Users, Clock } from "lucide-react";

interface Example {
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  icon: React.ComponentType<{ className?: string }>;
  topics: string[];
  serverCode: string;
  clientCode: string;
}

const examples: Example[] = [
  {
    title: "Simple Chat Room",
    description: "Learn the basics by building a real-time chat application. Perfect for understanding room creation, message handling, and state synchronization.",
    difficulty: "Beginner",
    icon: Users,
    topics: ["Room lifecycle", "Message handling", "Broadcasting"],
    serverCode: `import { Room, Client } from 'gameon-multiplayer';

interface ChatState {
  messages: { author: string; text: string; timestamp: number }[];
  users: Map<string, string>;
}

export class ChatRoom extends Room<ChatState> {
  onCreate() {
    this.setState({
      messages: [],
      users: new Map()
    });

    this.onMessage('chat', (client, data) => {
      const username = this.state.users.get(client.sessionId) || 'Anonymous';
      const message = {
        author: username,
        text: data.text,
        timestamp: Date.now()
      };

      this.state.messages.push(message);

      // Keep only last 100 messages
      if (this.state.messages.length > 100) {
        this.state.messages.shift();
      }
    });
  }

  onJoin(client: Client, options: { username?: string }) {
    this.state.users.set(client.sessionId, options.username || 'Guest');
    this.broadcast('user_joined', { username: options.username });
  }

  onLeave(client: Client) {
    const username = this.state.users.get(client.sessionId);
    this.state.users.delete(client.sessionId);
    this.broadcast('user_left', { username });
  }
}`,
    clientCode: `using UnityEngine;
using GameOn.Networking;

public class ChatManager : MonoBehaviour
{
    private GameOnNetworkManager network;
    private Room chatRoom;

    async void Start()
    {
        network = GetComponent<GameOnNetworkManager>();
        await network.Connect();

        chatRoom = await network.JoinOrCreate("chat", new {
            username = "Player1"
        });

        chatRoom.OnMessage<ChatMessage>("chat", OnChatReceived);
        chatRoom.OnStateChange += OnStateChange;
    }

    public void SendMessage(string text)
    {
        chatRoom.Send("chat", new { text = text });
    }

    void OnChatReceived(ChatMessage msg)
    {
        Debug.Log($"{msg.author}: {msg.text}");
    }

    void OnStateChange(ChatState state)
    {
        // Update UI with message history
    }
}`,
  },
  {
    title: "Trivia Game",
    description: "Build a multiplayer quiz game with timed questions, scoring based on speed, and a real-time leaderboard.",
    difficulty: "Intermediate",
    icon: Brain,
    topics: ["Game phases", "Timers", "Score calculation", "State management"],
    serverCode: `import { Room, Client } from 'gameon-multiplayer';

interface TriviaState {
  phase: 'lobby' | 'question' | 'results' | 'final';
  currentQuestion: Question | null;
  questionNumber: number;
  players: Map<string, TriviaPlayer>;
  timeRemaining: number;
}

export class TriviaRoom extends Room<TriviaState> {
  private questions: Question[] = [];
  private timer: NodeJS.Timeout | null = null;

  onCreate(options: { category?: string }) {
    this.setState({
      phase: 'lobby',
      currentQuestion: null,
      questionNumber: 0,
      players: new Map(),
      timeRemaining: 0
    });

    this.loadQuestions(options.category || 'general');

    this.onMessage('ready', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.ready = true;
      this.checkAllReady();
    });

    this.onMessage('answer', (client, data) => {
      if (this.state.phase !== 'question') return;

      const player = this.state.players.get(client.sessionId);
      if (!player || player.answered) return;

      player.answered = true;
      player.lastAnswer = data.index;

      const correct = data.index === this.state.currentQuestion?.correctIndex;
      if (correct) {
        // Faster answers get more points
        const bonus = Math.floor(this.state.timeRemaining * 10);
        player.score += 100 + bonus;
      }

      this.send(client, 'answer_result', { correct, points: player.score });
      this.checkAllAnswered();
    });
  }

  private startQuestion() {
    if (this.state.questionNumber >= this.questions.length) {
      this.endGame();
      return;
    }

    this.state.phase = 'question';
    this.state.currentQuestion = this.questions[this.state.questionNumber];
    this.state.timeRemaining = 15;

    // Reset player answers
    this.state.players.forEach(p => {
      p.answered = false;
      p.lastAnswer = -1;
    });

    this.timer = setInterval(() => {
      this.state.timeRemaining--;
      if (this.state.timeRemaining <= 0) {
        this.showResults();
      }
    }, 1000);
  }

  private showResults() {
    if (this.timer) clearInterval(this.timer);
    this.state.phase = 'results';
    this.state.questionNumber++;

    setTimeout(() => this.startQuestion(), 5000);
  }
}`,
    clientCode: `using UnityEngine;
using UnityEngine.UI;
using GameOn.Networking;

public class TriviaManager : MonoBehaviour
{
    [SerializeField] private Text questionText;
    [SerializeField] private Button[] answerButtons;
    [SerializeField] private Text timerText;
    [SerializeField] private Transform leaderboard;

    private Room triviaRoom;

    async void Start()
    {
        var network = GetComponent<GameOnNetworkManager>();
        await network.Connect();

        triviaRoom = await network.JoinOrCreate("trivia", new {
            category = "history"
        });

        triviaRoom.OnStateChange += UpdateUI;
        triviaRoom.OnMessage<AnswerResult>("answer_result", OnAnswerResult);
    }

    void UpdateUI(TriviaState state)
    {
        timerText.text = state.timeRemaining.ToString();

        if (state.currentQuestion != null)
        {
            questionText.text = state.currentQuestion.text;
            for (int i = 0; i < answerButtons.Length; i++)
            {
                answerButtons[i].GetComponentInChildren<Text>().text =
                    state.currentQuestion.answers[i];
            }
        }

        // Update leaderboard
        UpdateLeaderboard(state.players);
    }

    public void SubmitAnswer(int index)
    {
        triviaRoom.Send("answer", new { index = index });
        DisableButtons();
    }

    void OnAnswerResult(AnswerResult result)
    {
        // Show correct/incorrect feedback
        StartCoroutine(ShowFeedback(result.correct));
    }
}`,
  },
  {
    title: "Real-Time Movement",
    description: "Implement smooth character movement with client-side prediction and server reconciliation for a responsive multiplayer experience.",
    difficulty: "Advanced",
    icon: Swords,
    topics: ["Prediction", "Interpolation", "Tick-based updates", "Input handling"],
    serverCode: `import { Room, Client } from 'gameon-multiplayer';

interface MovementState {
  players: Map<string, PlayerEntity>;
  tick: number;
}

interface PlayerEntity {
  id: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  lastProcessedInput: number;
}

export class MovementRoom extends Room<MovementState> {
  private readonly TICK_RATE = 20; // 20 updates per second
  private inputBuffer: Map<string, InputCommand[]> = new Map();

  onCreate() {
    this.setState({
      players: new Map(),
      tick: 0
    });

    this.onMessage('input', (client, data: InputCommand) => {
      const buffer = this.inputBuffer.get(client.sessionId) || [];
      buffer.push(data);
      this.inputBuffer.set(client.sessionId, buffer);
    });

    // Run game loop at fixed tick rate
    this.setTickRate(this.TICK_RATE);
  }

  onTick(deltaTime: number) {
    this.state.tick++;

    // Process all buffered inputs
    this.state.players.forEach((player, sessionId) => {
      const inputs = this.inputBuffer.get(sessionId) || [];

      for (const input of inputs) {
        this.applyInput(player, input);
        player.lastProcessedInput = input.sequence;
      }

      // Apply physics
      player.x += player.velocityX * deltaTime;
      player.y += player.velocityY * deltaTime;

      // Apply friction
      player.velocityX *= 0.9;
      player.velocityY *= 0.9;

      // Clamp to world bounds
      player.x = Math.max(0, Math.min(100, player.x));
      player.y = Math.max(0, Math.min(100, player.y));
    });

    // Clear input buffers
    this.inputBuffer.clear();

    // State automatically syncs to clients
  }

  private applyInput(player: PlayerEntity, input: InputCommand) {
    const speed = 10;
    if (input.up) player.velocityY += speed;
    if (input.down) player.velocityY -= speed;
    if (input.left) player.velocityX -= speed;
    if (input.right) player.velocityX += speed;
  }

  onJoin(client: Client) {
    this.state.players.set(client.sessionId, {
      id: client.sessionId,
      x: Math.random() * 100,
      y: Math.random() * 100,
      velocityX: 0,
      velocityY: 0,
      lastProcessedInput: 0
    });
    this.inputBuffer.set(client.sessionId, []);
  }
}`,
    clientCode: `using UnityEngine;
using GameOn.Networking;
using System.Collections.Generic;

public class PredictedMovement : MonoBehaviour
{
    private GameOnNetworkManager network;
    private Room room;
    private int inputSequence = 0;
    private Queue<InputCommand> pendingInputs = new Queue<InputCommand>();

    private Vector3 serverPosition;
    private Vector3 predictedPosition;

    async void Start()
    {
        network = GetComponent<GameOnNetworkManager>();
        await network.Connect();

        room = await network.JoinOrCreate("movement");
        room.OnStateChange += OnServerState;
    }

    void Update()
    {
        // Gather input
        var input = new InputCommand
        {
            sequence = ++inputSequence,
            up = Input.GetKey(KeyCode.W),
            down = Input.GetKey(KeyCode.S),
            left = Input.GetKey(KeyCode.A),
            right = Input.GetKey(KeyCode.D),
            deltaTime = Time.deltaTime
        };

        // Apply locally (prediction)
        ApplyInput(input);

        // Send to server
        room.Send("input", input);

        // Store for reconciliation
        pendingInputs.Enqueue(input);
    }

    void OnServerState(MovementState state)
    {
        var myPlayer = state.players[network.SessionId];
        serverPosition = new Vector3(myPlayer.x, 0, myPlayer.y);

        // Remove acknowledged inputs
        while (pendingInputs.Count > 0 &&
               pendingInputs.Peek().sequence <= myPlayer.lastProcessedInput)
        {
            pendingInputs.Dequeue();
        }

        // Reconciliation: replay unacknowledged inputs
        predictedPosition = serverPosition;
        foreach (var input in pendingInputs)
        {
            ApplyInputToPosition(input, ref predictedPosition);
        }

        // Smoothly correct if needed
        transform.position = Vector3.Lerp(transform.position, predictedPosition, 0.3f);
    }

    void ApplyInput(InputCommand input)
    {
        Vector3 movement = Vector3.zero;
        float speed = 10f;

        if (input.up) movement.z += speed;
        if (input.down) movement.z -= speed;
        if (input.left) movement.x -= speed;
        if (input.right) movement.x += speed;

        transform.position += movement * input.deltaTime;
    }
}`,
  },
  {
    title: "Turn-Based Card Game",
    description: "Create a card game with turn management, hand management, and card effects. Perfect for understanding turn-based multiplayer patterns.",
    difficulty: "Intermediate",
    icon: Trophy,
    topics: ["Turn management", "Card systems", "Private state", "Game rules"],
    serverCode: `import { Room, Client } from 'gameon-multiplayer';

interface CardGameState {
  phase: 'waiting' | 'playing' | 'ended';
  currentTurn: string;
  turnOrder: string[];
  turnTimeRemaining: number;
  players: Map<string, CardPlayer>;
  discardPile: Card[];
}

interface CardPlayer {
  id: string;
  hand: Card[]; // Private - only sent to owner
  playedCards: Card[]; // Public
  health: number;
}

export class CardGameRoom extends Room<CardGameState> {
  private deck: Card[] = [];
  private turnTimer: NodeJS.Timeout | null = null;

  onCreate() {
    this.setState({
      phase: 'waiting',
      currentTurn: '',
      turnOrder: [],
      turnTimeRemaining: 30,
      players: new Map(),
      discardPile: []
    });

    this.onMessage('play_card', (client, data: { cardId: string; target?: string }) => {
      if (this.state.currentTurn !== client.sessionId) {
        this.send(client, 'error', { message: 'Not your turn' });
        return;
      }

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
      if (cardIndex === -1) return;

      const card = player.hand.splice(cardIndex, 1)[0];
      player.playedCards.push(card);

      this.executeCardEffect(card, player, data.target);
      this.checkWinCondition();
    });

    this.onMessage('end_turn', (client) => {
      if (this.state.currentTurn === client.sessionId) {
        this.nextTurn();
      }
    });

    this.onMessage('draw_card', (client) => {
      if (this.state.currentTurn !== client.sessionId) return;

      const player = this.state.players.get(client.sessionId);
      if (player && player.hand.length < 7) {
        player.hand.push(this.drawCard());
      }
    });
  }

  // Override to send private hand data only to card owner
  getStateForClient(client: Client) {
    const state = { ...this.state };
    const sanitizedPlayers = new Map();

    this.state.players.forEach((player, id) => {
      if (id === client.sessionId) {
        sanitizedPlayers.set(id, player); // Full data for owner
      } else {
        sanitizedPlayers.set(id, {
          ...player,
          hand: player.hand.map(() => ({ hidden: true })) // Hide other hands
        });
      }
    });

    return { ...state, players: sanitizedPlayers };
  }

  private nextTurn() {
    if (this.turnTimer) clearTimeout(this.turnTimer);

    const currentIndex = this.state.turnOrder.indexOf(this.state.currentTurn);
    const nextIndex = (currentIndex + 1) % this.state.turnOrder.length;
    this.state.currentTurn = this.state.turnOrder[nextIndex];
    this.state.turnTimeRemaining = 30;

    // Draw card for new player
    const player = this.state.players.get(this.state.currentTurn);
    if (player) player.hand.push(this.drawCard());

    // Auto-end turn after timeout
    this.turnTimer = setTimeout(() => this.nextTurn(), 30000);
  }
}`,
    clientCode: `using UnityEngine;
using UnityEngine.UI;
using GameOn.Networking;
using System.Collections.Generic;

public class CardGameManager : MonoBehaviour
{
    [SerializeField] private Transform handContainer;
    [SerializeField] private Transform playedCardsContainer;
    [SerializeField] private GameObject cardPrefab;
    [SerializeField] private Text turnIndicator;
    [SerializeField] private Button endTurnButton;
    [SerializeField] private Button drawButton;

    private Room cardRoom;
    private List<CardUI> handCards = new List<CardUI>();

    async void Start()
    {
        var network = GetComponent<GameOnNetworkManager>();
        await network.Connect();

        cardRoom = await network.JoinOrCreate("card_game");
        cardRoom.OnStateChange += UpdateGameState;
    }

    void UpdateGameState(CardGameState state)
    {
        // Update turn indicator
        bool isMyTurn = state.currentTurn == GameOnNetworkManager.Instance.SessionId;
        turnIndicator.text = isMyTurn ? "Your Turn" : "Opponent's Turn";
        endTurnButton.interactable = isMyTurn;
        drawButton.interactable = isMyTurn;

        // Update hand (only shows our cards)
        var myPlayer = state.players[GameOnNetworkManager.Instance.SessionId];
        UpdateHandDisplay(myPlayer.hand);

        // Update opponent played cards
        foreach (var kvp in state.players)
        {
            if (kvp.Key != GameOnNetworkManager.Instance.SessionId)
            {
                UpdateOpponentDisplay(kvp.Value);
            }
        }
    }

    void UpdateHandDisplay(List<Card> cards)
    {
        // Clear existing
        foreach (var cardUI in handCards)
            Destroy(cardUI.gameObject);
        handCards.Clear();

        // Create new cards
        foreach (var card in cards)
        {
            var cardObj = Instantiate(cardPrefab, handContainer);
            var cardUI = cardObj.GetComponent<CardUI>();
            cardUI.Setup(card, OnCardClicked);
            handCards.Add(cardUI);
        }
    }

    void OnCardClicked(Card card)
    {
        cardRoom.Send("play_card", new { cardId = card.id });
    }

    public void OnEndTurnClicked()
    {
        cardRoom.Send("end_turn", new {});
    }

    public void OnDrawClicked()
    {
        cardRoom.Send("draw_card", new {});
    }
}`,
  },
];

const difficultyColors = {
  Beginner: "bg-emerald-500/10 text-emerald-400",
  Intermediate: "bg-yellow-500/10 text-yellow-400",
  Advanced: "bg-red-500/10 text-red-400",
};

export default function ExamplesPage() {
  return (
    <div className="pt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Docs
          </Link>
        </div>

        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-white mb-4">Code Examples</h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto">
            Learn by example with complete, working code for common multiplayer game patterns.
            Copy, modify, and build upon these foundations.
          </p>
        </div>

        {/* Examples */}
        <div className="space-y-16">
          {examples.map((example, index) => (
            <article
              key={example.title}
              id={example.title.toLowerCase().replace(/\s+/g, "-")}
              className="scroll-mt-24"
            >
              <div className="rounded-2xl bg-slate-800/50 border border-slate-700 overflow-hidden">
                {/* Header */}
                <div className="p-6 md:p-8 border-b border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
                        <example.icon className="h-6 w-6 text-violet-400" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white">{example.title}</h2>
                        <span className={`inline-block mt-1 text-xs px-2 py-1 rounded-full ${difficultyColors[example.difficulty]}`}>
                          {example.difficulty}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-slate-400">{example.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {example.topics.map((topic) => (
                      <span
                        key={topic}
                        className="text-xs px-2 py-1 rounded-full bg-slate-700 text-slate-300"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Code tabs */}
                <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-700">
                  {/* Server code */}
                  <div>
                    <div className="px-6 py-3 bg-slate-900/50 border-b border-slate-700">
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Code className="h-4 w-4" />
                        Server (TypeScript)
                      </div>
                    </div>
                    <pre className="p-4 text-sm overflow-x-auto max-h-96">
                      <code className="text-slate-300">{example.serverCode}</code>
                    </pre>
                  </div>

                  {/* Client code */}
                  <div>
                    <div className="px-6 py-3 bg-slate-900/50 border-b border-slate-700">
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Gamepad2 className="h-4 w-4" />
                        Client (Unity C#)
                      </div>
                    </div>
                    <pre className="p-4 text-sm overflow-x-auto max-h-96">
                      <code className="text-slate-300">{example.clientCode}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* More examples CTA */}
        <div className="mt-16 p-8 rounded-2xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/30 text-center">
          <h3 className="text-xl font-semibold text-white mb-2">Need More Examples?</h3>
          <p className="text-slate-400 mb-6">
            Check out our GitHub repository for additional examples and full game implementations.
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/docs/api"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
            >
              API Reference
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/unity-sdk"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
            >
              Unity SDK Guide
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
