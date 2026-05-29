Subject: RE: Turbo Type multiplayer — "typing_race" game type + wss:// — both done

Hi Turbo Type team,

Great news on both items. Short version:

  1. ✅ We added a "typing_race" relay game type. It accepts race_setup / progress
     / finish and will NOT reject them with "Game not in progress" — relaying works
     as soon as players are in the room.
  2. ✅ wss:// (TLS) is already live. The catch: it's on our custom domain, not the
     raw Elastic Beanstalk hostname. Point at multiplayer.gameonguy.com and you're set.

Everything you need to change is the connection host (item 2). Your gameType
"typing_race" and message shapes are exactly what we implemented.

================================================================================
WHAT YOU NEED TO DO TO CONNECT
================================================================================

ONE change: use our custom domain, not the elasticbeanstalk.com hostname.

  Use:    wss://multiplayer.gameonguy.com/ws      (HTTPS pages — production)
          ws://multiplayer.gameonguy.com/ws        (HTTP localhost — dev, also fine)

  Not:    ws(s)://gameonguy-production.eba-pmb36kcs.us-east-1.elasticbeanstalk.com/ws

Why wss:// to the EB hostname timed out: our TLS certificate is issued for
multiplayer.gameonguy.com. The raw *.elasticbeanstalk.com hostname has no matching
cert, so the browser's TLS handshake fails (cert principal mismatch) and the
connection hangs. It will never work over wss://. The custom domain points at the
same load balancer with the correct cert, so TLS is already terminated there today.

Your "auto-select ws:// vs wss:// from the page protocol" logic is perfect — just
swap the host to multiplayer.gameonguy.com and both schemes resolve correctly.

You can confirm TLS yourself right now:
    curl https://multiplayer.gameonguy.com/health
    -> {"status":"ok","clients":0}

================================================================================
ANSWERS TO YOUR QUESTIONS
================================================================================

Q1. Can you add a "typing_race" game type? Timeline?
    Done and LIVE on production. room_create with { gameType: "typing_race" } now
    creates a relay room — verified end-to-end against wss://multiplayer.gameonguy.com/ws
    (auth → room_create → room_join → race_setup → progress → finish → game_end
    with standings). The lobby flow you already have (create/join/presence/ready)
    is unchanged.

Q2. Can you enable wss:// (TLS)?
    Already enabled — at wss://multiplayer.gameonguy.com/ws. No work needed beyond
    pointing at that host (see above).

Q3. Which relay shape did you implement?
    The authoritative state_update (your "Preferred" option). On every race_setup,
    progress, and finish we broadcast the full snapshot to everyone in the room:

        { "type": "state_update",
          "payload": {
            "state": {
              "status":  "waiting" | "racing" | "finished",
              "text":    "<the sentence everyone types>",
              "startAt": <epoch ms>,
              "players": [
                { "id", "username", "position" (0-100), "wpm", "accuracy", "finished" }
              ]
            }
          }
        }

    Note we fold the host's text + startAt INTO the state_update (status="racing"),
    so a single message stream carries both the "go" signal and live progress — you
    don't need a separate channel for the race text. If you'd actually prefer the
    "echo game_action to peers" shape instead, it's a small change on our end; just
    say the word.

Q4. Rate limits for progress (~8/sec/player)?
    Our limiter allows 100 messages/sec per client, so 8/sec is comfortably fine.
    No throttling needed on your side for normal play.

================================================================================
typing_race PROTOCOL (full reference)
================================================================================

Connect / lobby (unchanged, already working for you):
    welcome -> auth(guest) -> auth_success
    room_create { gameType: "typing_race" } -> room_created
    room_join { roomId } -> room_joined
    player_ready, player_joined, player_left  (presence)

Client -> Server, all sent as game_action:
    { "type": "game_action", "payload": { "type": "race_setup",
        "data": { "text": "<sentence>", "startAt": <epoch ms> } } }   (HOST ONLY)
    { "type": "game_action", "payload": { "type": "progress",
        "data": { "position": 0-100, "wpm": <int>, "accuracy": <int> } } }  (~8/sec)
    { "type": "game_action", "payload": { "type": "finish",
        "data": { "time": <sec>, "wpm": <int>, "accuracy": <int> } } }

    (Note the game_action payload nests { type, data } — consistent with the rest
     of the protocol. This matches what you described.)

Server -> Clients:
    state_update   — broadcast on every setup/progress/finish (shape above).
    game_end       — broadcast when all players finish, OR 15s after the FIRST
                     finisher (grace window), whichever comes first:

        { "type": "game_end",
          "payload": { "results": { "standings": [
              { "id", "username", "place", "wpm", "accuracy", "time", "finished" }
          ] } } }

Ranking: finishers are placed in finish order (place 1, 2, 3…). Anyone who hasn't
finished when the grace window closes is ranked after the finishers by furthest
position (then wpm), with time = null and finished = false.

Behavior notes you may care about:
  • race_setup is host-only (room creator). A non-host race_setup is ignored, not
    errored. A fresh race_setup after game_end resets the room for a rematch.
  • progress/finish are accepted only while status = "racing"; duplicates and
    stragglers are ignored safely.
  • position and accuracy are clamped to 0-100; wpm is floored at 0.

================================================================================
NICE-TO-HAVE: short room code
================================================================================

room_created / room_joined still return a UUID in payload.id. We haven't switched
to the short "ABCD1234" code yet — it touches our other games' room lookups, so
we want to do it as a non-breaking addition (extra field, UUID still valid). Since
your client already tolerates the UUID, we've left this as a fast follow rather
than block this rollout. Want us to prioritize it?

================================================================================

That's it — flip your host to multiplayer.gameonguy.com and your "Race Friends"
flow should work end to end with no other changes. typing_race is already live on
production and verified end-to-end. Happy to hop on a quick call or look at your
client if anything behaves unexpectedly.

Thanks,
Game On Dude! team
multiplayer.gameonguy.com
