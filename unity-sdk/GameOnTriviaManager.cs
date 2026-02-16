/**
 * Game On Dude! SDK for Unity
 * www.gameonguy.com
 */

using System;
using System.Collections.Generic;
using UnityEngine;

namespace GameOn.Networking
{
    /// <summary>
    /// High-level manager for trivia games (Lightning Round, TimeQuest).
    /// Handles questions, answers, scoring, and leaderboards.
    /// </summary>
    public class GameOnTriviaManager : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private GameOnNetworkManager networkManager;

        [Header("Settings")]
        [SerializeField] private bool autoAnswerOnTimeout = false;

        // Current game state
        private TriviaGameState currentState;
        private Question currentQuestion;
        private float questionTimer;
        private bool isAnswerPending;

        // Events
        public event Action<TriviaGameState> OnGameStateChanged;
        public event Action<Question> OnQuestionReceived;
        public event Action<QuestionResult> OnQuestionResult;
        public event Action<List<LeaderboardEntry>> OnLeaderboardUpdated;
        public event Action<RoundEndData> OnRoundEnded;
        public event Action<GameEndData> OnGameEnded;
        public event Action<List<Category>> OnCategoriesReceived;
        public event Action<Category> OnCategorySelected;
        public event Action<float> OnTimerUpdated;
        public event Action OnAnswerAccepted;
        public event Action<string> OnAnswerRejected;

        // Properties
        public TriviaGameState CurrentState => currentState;
        public Question CurrentQuestion => currentQuestion;
        public float TimeRemaining => questionTimer;
        public bool CanAnswer => currentState == TriviaGameState.AcceptingAnswers && !isAnswerPending;

        private void Awake()
        {
            if (networkManager == null)
            {
                networkManager = GetComponent<XogosNetworkManager>();
            }
        }

        private void OnEnable()
        {
            if (networkManager != null)
            {
                networkManager.OnMessage += HandleServerMessage;
            }
        }

        private void OnDisable()
        {
            if (networkManager != null)
            {
                networkManager.OnMessage -= HandleServerMessage;
            }
        }

        private void Update()
        {
            if (currentState == TriviaGameState.AcceptingAnswers && questionTimer > 0)
            {
                questionTimer -= Time.deltaTime;
                OnTimerUpdated?.Invoke(questionTimer);

                if (questionTimer <= 0 && autoAnswerOnTimeout && !isAnswerPending)
                {
                    // Time's up - let server handle timeout
                    questionTimer = 0;
                }
            }
        }

        #region Public API

        /// <summary>
        /// Submit an answer to the current question.
        /// </summary>
        public void SubmitAnswer(string answerId)
        {
            if (!CanAnswer)
            {
                Debug.LogWarning("Cannot submit answer in current state");
                return;
            }

            isAnswerPending = true;
            networkManager.SendGameAction("submit_answer", new { answerId });
        }

        /// <summary>
        /// Select a category (for category selection phase).
        /// </summary>
        public void SelectCategory(string categoryId)
        {
            if (currentState != TriviaGameState.CategorySelection)
            {
                Debug.LogWarning("Cannot select category in current state");
                return;
            }

            networkManager.SendGameAction("select_category", categoryId);
        }

        /// <summary>
        /// Select a question (for games with question selection).
        /// </summary>
        public void SelectQuestion(string questionId)
        {
            networkManager.SendGameAction("select_question", new { questionId });
        }

        /// <summary>
        /// Signal ready to start.
        /// </summary>
        public void SetReady(bool ready = true)
        {
            networkManager.SetReady(ready);
        }

        #endregion

        #region Message Handling

        private void HandleServerMessage(string type, object payload)
        {
            switch (type)
            {
                case "round_start":
                    HandleRoundStart(payload);
                    break;

                case "category_selection":
                    HandleCategorySelection(payload);
                    break;

                case "category_selected":
                    HandleCategorySelected(payload);
                    break;

                case "question":
                    HandleQuestion(payload);
                    break;

                case "answers_open":
                    HandleAnswersOpen(payload);
                    break;

                case "answer_accepted":
                    HandleAnswerAccepted(payload);
                    break;

                case "answer_rejected":
                    HandleAnswerRejected(payload);
                    break;

                case "question_results":
                    HandleQuestionResults(payload);
                    break;

                case "round_end":
                    HandleRoundEnd(payload);
                    break;

                case "game_end":
                    HandleGameEnd(payload);
                    break;

                case "player_answered":
                    HandlePlayerAnswered(payload);
                    break;
            }
        }

        private void HandleRoundStart(object payload)
        {
            currentState = TriviaGameState.RoundStart;
            OnGameStateChanged?.Invoke(currentState);

            Debug.Log("Round started");
        }

        private void HandleCategorySelection(object payload)
        {
            currentState = TriviaGameState.CategorySelection;
            OnGameStateChanged?.Invoke(currentState);

            // Parse categories from payload
            var data = payload as Dictionary<string, object>;
            if (data != null && data.TryGetValue("availableCategories", out var cats))
            {
                var categories = ParseCategories(cats);
                OnCategoriesReceived?.Invoke(categories);
            }
        }

        private void HandleCategorySelected(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data != null && data.TryGetValue("category", out var catData))
            {
                var category = ParseCategory(catData);
                OnCategorySelected?.Invoke(category);
            }
        }

        private void HandleQuestion(object payload)
        {
            currentState = TriviaGameState.ShowingQuestion;
            OnGameStateChanged?.Invoke(currentState);

            var data = payload as Dictionary<string, object>;
            if (data != null && data.TryGetValue("question", out var qData))
            {
                currentQuestion = ParseQuestion(qData);
                OnQuestionReceived?.Invoke(currentQuestion);
            }
        }

        private void HandleAnswersOpen(object payload)
        {
            currentState = TriviaGameState.AcceptingAnswers;
            isAnswerPending = false;
            OnGameStateChanged?.Invoke(currentState);

            var data = payload as Dictionary<string, object>;
            if (data != null && data.TryGetValue("timeLimit", out var time))
            {
                questionTimer = Convert.ToSingle(time) / 1000f; // Convert ms to seconds
            }
        }

        private void HandleAnswerAccepted(object payload)
        {
            OnAnswerAccepted?.Invoke();
        }

        private void HandleAnswerRejected(object payload)
        {
            isAnswerPending = false;
            var data = payload as Dictionary<string, object>;
            var reason = data?.ContainsKey("reason") == true ? data["reason"].ToString() : "Unknown";
            OnAnswerRejected?.Invoke(reason);
        }

        private void HandleQuestionResults(object payload)
        {
            currentState = TriviaGameState.ShowingResults;
            OnGameStateChanged?.Invoke(currentState);

            var data = payload as Dictionary<string, object>;
            if (data != null)
            {
                var result = ParseQuestionResult(data);
                OnQuestionResult?.Invoke(result);

                if (data.TryGetValue("leaderboard", out var lb))
                {
                    var leaderboard = ParseLeaderboard(lb);
                    OnLeaderboardUpdated?.Invoke(leaderboard);
                }
            }
        }

        private void HandleRoundEnd(object payload)
        {
            currentState = TriviaGameState.RoundEnd;
            OnGameStateChanged?.Invoke(currentState);

            var data = payload as Dictionary<string, object>;
            if (data != null)
            {
                var roundData = new RoundEndData
                {
                    Round = data.ContainsKey("round") ? Convert.ToInt32(data["round"]) : 0
                };

                if (data.TryGetValue("leaderboard", out var lb))
                {
                    roundData.Leaderboard = ParseLeaderboard(lb);
                }

                OnRoundEnded?.Invoke(roundData);
            }
        }

        private void HandleGameEnd(object payload)
        {
            currentState = TriviaGameState.GameEnd;
            OnGameStateChanged?.Invoke(currentState);

            var data = payload as Dictionary<string, object>;
            if (data != null)
            {
                var gameData = new GameEndData();

                if (data.TryGetValue("finalLeaderboard", out var lb))
                {
                    gameData.FinalLeaderboard = ParseLeaderboard(lb);
                }

                OnGameEnded?.Invoke(gameData);
            }
        }

        private void HandlePlayerAnswered(object payload)
        {
            // Could show visual indicator that another player answered
            var data = payload as Dictionary<string, object>;
            if (data != null && data.TryGetValue("playerId", out var pid))
            {
                Debug.Log($"Player {pid} answered");
            }
        }

        #endregion

        #region Parsing Helpers

        private List<Category> ParseCategories(object data)
        {
            var categories = new List<Category>();
            if (data is IList<object> list)
            {
                foreach (var item in list)
                {
                    categories.Add(ParseCategory(item));
                }
            }
            return categories;
        }

        private Category ParseCategory(object data)
        {
            var cat = new Category();
            if (data is Dictionary<string, object> dict)
            {
                cat.Id = dict.ContainsKey("id") ? dict["id"].ToString() : "";
                cat.Name = dict.ContainsKey("name") ? dict["name"].ToString() : "";
                cat.Description = dict.ContainsKey("description") ? dict["description"].ToString() : "";
                cat.QuestionCount = dict.ContainsKey("questionCount") ? Convert.ToInt32(dict["questionCount"]) : 0;
            }
            return cat;
        }

        private Question ParseQuestion(object data)
        {
            var question = new Question();
            if (data is Dictionary<string, object> dict)
            {
                question.Id = dict.ContainsKey("id") ? dict["id"].ToString() : "";
                question.Text = dict.ContainsKey("text") ? dict["text"].ToString() : "";
                question.Category = dict.ContainsKey("category") ? dict["category"].ToString() : "";
                question.Points = dict.ContainsKey("points") ? Convert.ToInt32(dict["points"]) : 100;
                question.TimeLimit = dict.ContainsKey("timeLimit") ? Convert.ToSingle(dict["timeLimit"]) / 1000f : 15f;

                if (dict.TryGetValue("answers", out var answers) && answers is IList<object> answerList)
                {
                    question.Answers = new List<Answer>();
                    foreach (var ans in answerList)
                    {
                        if (ans is Dictionary<string, object> ansDict)
                        {
                            question.Answers.Add(new Answer
                            {
                                Id = ansDict.ContainsKey("id") ? ansDict["id"].ToString() : "",
                                Text = ansDict.ContainsKey("text") ? ansDict["text"].ToString() : ""
                            });
                        }
                    }
                }
            }
            return question;
        }

        private QuestionResult ParseQuestionResult(Dictionary<string, object> data)
        {
            var result = new QuestionResult();
            result.CorrectAnswerId = data.ContainsKey("correctAnswerId") ? data["correctAnswerId"].ToString() : "";
            result.Results = new Dictionary<string, PlayerQuestionResult>();

            if (data.TryGetValue("results", out var results) && results is Dictionary<string, object> resultDict)
            {
                foreach (var kvp in resultDict)
                {
                    if (kvp.Value is Dictionary<string, object> pResult)
                    {
                        result.Results[kvp.Key] = new PlayerQuestionResult
                        {
                            IsCorrect = pResult.ContainsKey("isCorrect") && Convert.ToBoolean(pResult["isCorrect"]),
                            Points = pResult.ContainsKey("points") ? Convert.ToInt32(pResult["points"]) : 0
                        };
                    }
                }
            }

            return result;
        }

        private List<LeaderboardEntry> ParseLeaderboard(object data)
        {
            var leaderboard = new List<LeaderboardEntry>();
            if (data is IList<object> list)
            {
                foreach (var item in list)
                {
                    if (item is Dictionary<string, object> dict)
                    {
                        leaderboard.Add(new LeaderboardEntry
                        {
                            PlayerId = dict.ContainsKey("playerId") ? dict["playerId"].ToString() : "",
                            Username = dict.ContainsKey("username") ? dict["username"].ToString() : "",
                            Score = dict.ContainsKey("score") ? Convert.ToInt32(dict["score"]) : 0,
                            Rank = dict.ContainsKey("rank") ? Convert.ToInt32(dict["rank"]) : 0
                        });
                    }
                }
            }
            return leaderboard;
        }

        #endregion
    }

    #region Data Types

    public enum TriviaGameState
    {
        Waiting,
        RoundStart,
        CategorySelection,
        ShowingQuestion,
        AcceptingAnswers,
        ShowingResults,
        RoundEnd,
        GameEnd
    }

    [Serializable]
    public class Category
    {
        public string Id;
        public string Name;
        public string Description;
        public int QuestionCount;
        public string IconUrl;
    }

    [Serializable]
    public class Question
    {
        public string Id;
        public string Text;
        public string Category;
        public int Points;
        public float TimeLimit;
        public List<Answer> Answers;
    }

    [Serializable]
    public class Answer
    {
        public string Id;
        public string Text;
    }

    [Serializable]
    public class QuestionResult
    {
        public string CorrectAnswerId;
        public Dictionary<string, PlayerQuestionResult> Results;
    }

    [Serializable]
    public class PlayerQuestionResult
    {
        public bool IsCorrect;
        public int Points;
        public int Streak;
        public int TimeBonus;
    }

    [Serializable]
    public class LeaderboardEntry
    {
        public string PlayerId;
        public string Username;
        public int Score;
        public int Rank;
    }

    [Serializable]
    public class RoundEndData
    {
        public int Round;
        public List<LeaderboardEntry> Leaderboard;
    }

    [Serializable]
    public class GameEndData
    {
        public List<LeaderboardEntry> FinalLeaderboard;
        public Dictionary<string, object> PlayerStats;
    }

    #endregion
}
