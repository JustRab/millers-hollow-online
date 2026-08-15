import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Moon,
  Sun,
  Send,
  Shield,
  Eye,
  Volume2,
  Copy,
  Check,
  Users,
  DoorOpen,
  ChevronRight,
  Skull,
  ScrollText,
  Sparkles,
  Clock3,
  AlertTriangle,
  Lock,
  Unlock,
  Play,
  X,
  BookOpen,
  Lightbulb,
} from "lucide-react";

type Phase = "lobby" | "night" | "day";
type Player = { id: string; name: string; alive: boolean; role?: string };
type Message = {
  name: string;
  text: string;
  time: string;
  system?: boolean;
  wolf?: boolean;
};
type GameEvent = {
  id: number;
  title: string;
  detail: string;
  tone: "info" | "danger" | "success";
};
type DeathCause = "voted" | "night" | null;
type RolePreset = "classic" | "chaos" | "beginner";
type NightHistory = {
  night: number;
  victim: { id: string; name: string; role: string } | null;
  protected: { id: string; name: string } | null;
};
type VoteHistory = {
  phase: number;
  votedOut: { id: string; name: string; role: string };
  votes: Record<string, string>;
};

type GameState = {
  room: string;
  phase: Phase;
  phaseEndsAt: number;
  night: number;
  hostId: string;
  winner: "village" | "werewolves" | null;
  lastEvent: GameEvent | null;
  pendingHunterId: string | null;
  pendingDoctorTargetId?: string | null;
  pendingDoctorSource?: "night" | "vote" | null;
  doctorDecisionNeeded?: boolean;
  readyIds: string[];
  players: Player[];
  me: { id: string; name: string; role: string; alive: boolean } | null;
  inspections: Record<string, string>;
  myVote: string | null;
  myNightAction: string | null;
  voteCounts: Record<string, number>;
  messages: Message[];
  wolfChatMessages?: Message[];
  wolfChatVisible?: boolean;
  girlPeekActive?: boolean;
  wolfWatchedIds?: string[];
  lovers?: string[];
  rolePreset?: RolePreset;
  roomLocked?: boolean;
  tutorialEnabled?: boolean;
  tutorialHint?: string;
  sessionToken?: string;
  nightHistory?: NightHistory[];
  voteHistory?: VoteHistory[];
};

type SoundCue =
  | "join"
  | "chat"
  | "vote"
  | "action"
  | "protect"
  | "phase"
  | "death"
  | "tie"
  | "success"
  | "danger"
  | "info";

const socket: Socket = io();
let sharedAudioContext: AudioContext | null = null;

function primeAudio() {
  if (!window.AudioContext) return;
  sharedAudioContext ??= new window.AudioContext();
  void sharedAudioContext.resume();
}

function playUiSound(kind: SoundCue, enabled: boolean) {
  if (!enabled || !window.AudioContext) return;

  sharedAudioContext ??= new window.AudioContext();
  const audioContext = sharedAudioContext;
  if (audioContext.state === "suspended") void audioContext.resume();

  const patterns: Record<
    SoundCue,
    { notes: number[]; type: OscillatorType; gap: number; length: number }
  > = {
    join: { notes: [262, 392, 523], type: "sine", gap: 0.09, length: 0.2 },
    chat: { notes: [660, 880], type: "sine", gap: 0.06, length: 0.1 },
    vote: { notes: [220, 277], type: "triangle", gap: 0.08, length: 0.16 },
    action: { notes: [330, 440], type: "square", gap: 0.07, length: 0.13 },
    protect: { notes: [392, 523, 659], type: "sine", gap: 0.1, length: 0.2 },
    phase: {
      notes: [196, 294, 392],
      type: "triangle",
      gap: 0.12,
      length: 0.24,
    },
    death: { notes: [196, 147, 110], type: "sawtooth", gap: 0.13, length: 0.3 },
    tie: { notes: [294, 294], type: "square", gap: 0.16, length: 0.12 },
    success: {
      notes: [392, 494, 587, 784],
      type: "sine",
      gap: 0.09,
      length: 0.24,
    },
    danger: { notes: [165, 123, 92], type: "sawtooth", gap: 0.14, length: 0.3 },
    info: { notes: [330], type: "sine", gap: 0, length: 0.18 },
  };

  const pattern = patterns[kind];
  const start = audioContext.currentTime + 0.01;

  pattern.notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noteStart = start + index * pattern.gap;

    oscillator.type = pattern.type;
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * (kind === "death" || kind === "danger" ? 0.72 : 1.04),
      noteStart + pattern.length,
    );

    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(
      kind === "danger" || kind === "death" ? 0.055 : 0.07,
      noteStart + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + pattern.length);

    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + pattern.length + 0.02);
  });
}

function eventSound(title: string, tone: GameEvent["tone"]): SoundCue {
  const normalized = title.toLowerCase();
  if (
    normalized.includes("voted") ||
    normalized.includes("died") ||
    normalized.includes("fired")
  )
    return "death";
  if (normalized.includes("tie")) return "tie";
  if (normalized.includes("protect")) return "protect";
  if (normalized.includes("win"))
    return tone === "success" ? "success" : "danger";
  if (
    normalized.includes("night") ||
    normalized.includes("daylight") ||
    normalized.includes("game begins") ||
    normalized.includes("awake")
  )
    return "phase";
  return tone;
}

function roleSummary(role: string): string {
  switch (role) {
    case "Seer":
      return "Inspect one player each night to learn their true role.";
    case "Werewolf":
      return "Coordinate with the pack and remove villagers at night.";
    case "Doctor":
      return "When someone is marked to die, decide once whether to save them.";
    case "Hunter":
      return "If eliminated, you may fire one final shot.";
    case "Dog":
      return "At night, choose to side with villagers or wolves.";
    case "GirlOfTheNight":
      return "Peek at wolf chat; wolves only get warned after 3 seconds.";
    case "Cupid":
      return "Bind two players as lovers linked by fate.";
    case "Maid":
      return "Swap your role with another player at night.";
    default:
      return "Gather clues, survive, and help your side win.";
  }
}

function roleObjective(role: string): string {
  if (role === "Werewolf") return "Outnumber the village while staying hidden.";
  if (role === "GirlOfTheNight")
    return "Peek for intel and back out before wolves see the eye warning.";
  if (role === "Cupid") return "Create a risky lover pair and read the table.";
  return "Identify the wolves before they control the village.";
}

function roleThemeClass(role: string) {
  switch (role) {
    case "Werewolf":
      return "theme-werewolf";
    case "Seer":
      return "theme-seer";
    case "Doctor":
      return "theme-doctor";
    case "Hunter":
      return "theme-hunter";
    case "Dog":
      return "theme-dog";
    case "GirlOfTheNight":
      return "theme-girl";
    case "Cupid":
      return "theme-cupid";
    case "Maid":
      return "theme-maid";
    default:
      return "theme-villager";
  }
}

function roleTag(role: string) {
  switch (role) {
    case "Werewolf":
      return "MOON";
    case "Seer":
      return "VISION";
    case "Doctor":
      return "AID";
    case "Hunter":
      return "SHOT";
    case "Dog":
      return "PACK";
    case "GirlOfTheNight":
      return "SHADOW";
    case "Cupid":
      return "BOND";
    case "Maid":
      return "SWAP";
    default:
      return "VILLAGE";
  }
}

function roleGlyph(role: string) {
  switch (role) {
    case "Werewolf":
      return "☾";
    case "Seer":
      return "◌";
    case "Doctor":
      return "✚";
    case "Hunter":
      return "✦";
    case "Dog":
      return "⚑";
    case "GirlOfTheNight":
      return "◉";
    case "Cupid":
      return "♥";
    case "Maid":
      return "✧";
    default:
      return "○";
  }
}

function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [nameDraft, setNameDraft] = useState(
    () => localStorage.getItem("millers-name") ?? "",
  );
  const [roomDraft, setRoomDraft] = useState(
    () =>
      new URLSearchParams(window.location.search).get("room")?.toUpperCase() ||
      "MILL-7Q2",
  );
  const [sessionToken, setSessionToken] = useState(
    () => localStorage.getItem("millers-token") ?? "",
  );
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState("");
  const [wolfDraft, setWolfDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [connected, setConnected] = useState(socket.connected);
  const [audioEnabled, setAudioEnabled] = useState(
    () => localStorage.getItem("millers-audio") !== "off",
  );
  const [notice, setNotice] = useState<
    | GameEvent
    | { id: number; title: string; detail: string; tone: "info" }
    | null
  >(null);
  const [deathCause, setDeathCause] = useState<DeathCause>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [presetDraft, setPresetDraft] = useState<RolePreset>("classic");
  const [dismissedTutorialHint, setDismissedTutorialHint] = useState(false);
  const [cupidTargets, setCupidTargets] = useState<string[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  const seenEvent = useRef(0);
  const wasAlive = useRef<boolean | null>(null);
  const villageChatEndRef = useRef<HTMLDivElement | null>(null);
  const wolfChatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    socket.on("game:state", (nextState: GameState) => {
      if (wasAlive.current === true && nextState.me && !nextState.me.alive) {
        setDeathCause(
          nextState.lastEvent?.title.includes("voted out") ? "voted" : "night",
        );
      }

      if (nextState.sessionToken && nextState.sessionToken !== sessionToken) {
        setSessionToken(nextState.sessionToken);
        localStorage.setItem("millers-token", nextState.sessionToken);
      }

      if (nextState.winner && !state?.winner) {
        setShowSummary(true);
      }

      wasAlive.current = nextState.me?.alive ?? null;
      setState(nextState);

      if (nextState.lastEvent && nextState.lastEvent.id > seenEvent.current) {
        seenEvent.current = nextState.lastEvent.id;
        setNotice(nextState.lastEvent);
        playUiSound(
          eventSound(nextState.lastEvent.title, nextState.lastEvent.tone),
          audioEnabled,
        );
        window.setTimeout(() => {
          setNotice((current) =>
            current?.id === nextState.lastEvent?.id ? null : current,
          );
        }, 4200);
      }
    });

    socket.on("game:error", (message: string) => {
      setNotice({
        id: Date.now(),
        title: "Error",
        detail: message,
        tone: "danger",
      });
      window.setTimeout(() => {
        setNotice((current) => (current?.title === "Error" ? null : current));
      }, 3000);
    });

    socket.on(
      "game:action-confirmed",
      (event: { title: string; detail: string }) => {
        const confirmation = {
          ...event,
          id: Date.now(),
          tone: "info" as const,
        };
        setNotice(confirmation);
        playUiSound(
          event.title.toLowerCase().includes("vote")
            ? "vote"
            : event.title.toLowerCase().includes("protection")
              ? "protect"
              : "action",
          audioEnabled,
        );

        window.setTimeout(() => {
          setNotice((current) =>
            current?.id === confirmation.id ? null : current,
          );
        }, 3200);
      },
    );

    socket.on("chat:received", () => playUiSound("chat", audioEnabled));

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("game:state");
      socket.off("game:action-confirmed");
      socket.off("chat:received");
      socket.off("game:error");
    };
  }, [audioEnabled, sessionToken, state?.winner]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (state?.rolePreset) {
      setPresetDraft(state.rolePreset);
    }
  }, [state?.rolePreset]);

  useEffect(() => {
    setDismissedTutorialHint(false);
  }, [state?.tutorialHint, state?.phase, state?.night]);

  useEffect(() => {
    if (state?.phase !== "night" || state?.me?.role !== "Cupid" || !state?.me?.alive) {
      setCupidTargets([]);
    }
  }, [state?.phase, state?.me?.role, state?.me?.alive]);

  useEffect(() => {
    villageChatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [state?.messages.length]);

  useEffect(() => {
    wolfChatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [state?.wolfChatMessages?.length, state?.wolfChatVisible]);

  const joinGame = () => {
    const cleanName = nameDraft.trim().slice(0, 18);
    const cleanRoom = roomDraft
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 16);
    if (!cleanName || !cleanRoom) return;

    primeAudio();
    playUiSound("join", audioEnabled);
    localStorage.setItem("millers-name", cleanName);
    socket.emit("room:join", { name: cleanName, room: cleanRoom });
  };

  const rejoinGame = () => {
    const cleanName = nameDraft.trim().slice(0, 18);
    const cleanRoom = roomDraft
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 16);
    if (!cleanName || !cleanRoom || !sessionToken) return;

    primeAudio();
    playUiSound("join", audioEnabled);
    socket.emit("room:rejoin", {
      token: sessionToken,
      name: cleanName,
      room: cleanRoom,
    });
  };

  const setPreset = (preset: RolePreset) => {
    setPresetDraft(preset);
    socket.emit("room:set-preset", preset);
  };

  const toggleTutorial = () => {
    socket.emit("room:toggle-tutorial");
  };

  const kickPlayer = (playerId: string) => {
    socket.emit("host:kick", playerId);
  };

  const lockRoom = (locked: boolean) => {
    socket.emit("host:lock-room", locked);
  };

  const forceStart = () => {
    socket.emit("host:force-start");
  };

  const endMatch = () => {
    socket.emit("host:end-match");
  };

  const meOrNull = state?.me ?? null;
  const phase = state?.phase ?? "lobby";
  const isLobby = phase === "lobby";
  const isNight = phase === "night";
  const isDay = phase === "day";
  const isDead = meOrNull ? !meOrNull.alive : false;
  const humans =
    state?.players.filter((player) => !player.id.endsWith("-bot")) ?? [];
  const isReady = meOrNull
    ? (state?.readyIds.includes(meOrNull.id) ?? false)
    : false;
  const readyCount = humans.filter((player) =>
    state?.readyIds.includes(player.id),
  ).length;
  const allPlayersReady =
    humans.length > 1 &&
    humans.every((player) => state?.readyIds.includes(player.id));
  const selectedPlayer = state?.players.find(
    (player) => player.id === selected,
  );
  const inspectedRole =
    selected && state ? state.inspections[selected] : undefined;
  const isHost = meOrNull ? state?.hostId === meOrNull.id : false;
  const canHunterAct = meOrNull
    ? meOrNull.role === "Hunter" && state?.pendingHunterId === meOrNull.id
    : false;
  const secondsLeft = state
    ? Math.max(0, Math.ceil((state.phaseEndsAt - clock) / 1000))
    : 0;
  const timerText = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const voteTotal = state
    ? Object.values(state.voteCounts).reduce((total, count) => total + count, 0)
    : 0;
  const livingCount =
    state?.players.filter((player) => player.alive).length ?? 0;
  const phaseProgress = state?.phaseEndsAt
    ? Math.max(
        0,
        Math.min(100, Math.round((secondsLeft / (isNight ? 120 : 180)) * 100)),
      )
    : 0;
  const recentSystemEvents = useMemo(
    () =>
      (state?.messages ?? [])
        .filter((message) => message.system)
        .slice(-4)
        .reverse(),
    [state?.messages],
  );

  const helperHints = useMemo(() => {
    if (!meOrNull || !meOrNull.alive) {
      return canHunterAct
        ? [
            "You still have a final Hunter shot.",
            "Pick one living player before the timer ends.",
          ]
        : [
            "You are spectating now.",
            "Track votes and chat to help your team after the round.",
          ];
    }

    if (isLobby) {
      return [
        isReady ? "You are marked ready." : "Set ready to help the host start.",
        isHost
          ? "Host can start after all human players are ready."
          : "Wait for the host to start once everyone is ready.",
      ];
    }

    if (isNight) {
      if (meOrNull.role === "GirlOfTheNight")
        return [
          "Use peek only when needed.",
          "Wolves only get the eye warning after 3 seconds.",
        ];
      if (meOrNull.role === "Dog")
        return [
          "Choose your side once each night.",
          "This choice can shift win conditions quickly.",
        ];
      if (meOrNull.role === "Werewolf")
        return [
          "Coordinate with wolf chat.",
          "Submit your target before phase ends.",
        ];
      if (meOrNull.role === "Doctor")
        return [
          "Mark one player to save if they are attacked or voted out.",
          "Your first successful save reveals your role and theirs.",
        ];
      if (meOrNull.role === "Seer")
        return [
          "Inspect high-risk players first.",
          "Use chat behavior to guide inspections.",
        ];
      if (meOrNull.role === "Maid")
        return [
          "Swap can change team power instantly.",
          "Consider role timing before committing.",
        ];
      if (meOrNull.role === "Cupid")
        return [
          "Choose exactly two OTHER players.",
          "Cupid can bind lovers only once per match.",
        ];
      return [
        "Watch chat carefully for tells.",
        "Prepare a voting target for day.",
      ];
    }

    return [
      state?.myVote
        ? "Your vote is locked."
        : "Submit your vote before phase end.",
      "Track who pushes fast accusations and late vote swings.",
    ];
  }, [
    canHunterAct,
    isLobby,
    isNight,
    meOrNull,
    isReady,
    isHost,
    state?.myVote,
  ]);

  if (!state || !state.me) {
    return (
      <main className="app night join-screen">
        <div className="join-card">
          <div className="brand">
            <span className="brand-mark">
              <Moon size={17} fill="currentColor" />
            </span>
            <span>Millers Hollow</span>
          </div>
          <span className="section-label">JOIN THE VILLAGE</span>
          <h1>Choose your seat</h1>
          <p>
            Enter a name and room code. Share the room link with the people you
            want in your village.
          </p>

          <label className="join-label" htmlFor="room-code">
            ROOM CODE
          </label>
          <input
            id="room-code"
            className="join-input"
            maxLength={16}
            value={roomDraft}
            onChange={(event) => setRoomDraft(event.target.value.toUpperCase())}
            onKeyDown={(event) => event.key === "Enter" && joinGame()}
            placeholder="MILL-7Q2"
          />

          <label className="join-label" htmlFor="player-name">
            YOUR NAME
          </label>
          <div className="join-form">
            <input
              id="player-name"
              autoFocus
              maxLength={18}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && joinGame()}
              placeholder="Your village name"
            />
            <button
              className="primary-btn"
              disabled={!nameDraft.trim() || !roomDraft.trim()}
              onClick={joinGame}
            >
              Enter the village <ChevronRight size={16} />
            </button>
          </div>

          {sessionToken && (
            <div className="rejoin-section">
              <p className="rejoin-text">
                We found your previous session. Would you like to rejoin?
              </p>
              <button className="secondary-btn" onClick={rejoinGame}>
                <ChevronRight size={16} />
                Rejoin the game
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  const me = state.me;

  const toggleAudio = () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    localStorage.setItem("millers-audio", next ? "on" : "off");
  };

  const copyRoom = async () => {
    await navigator.clipboard?.writeText(
      `${window.location.origin}?room=${state.room}`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    socket.emit("chat:send", text);
    setDraft("");
  };

  const sendWolfMessage = () => {
    const text = wolfDraft.trim();
    if (!text) return;
    socket.emit("wolf:chat:send", text);
    setWolfDraft("");
  };

  const decideDoctor = (save: boolean) => {
    socket.emit("doctor:decide", save);
  };

  const handleRoleAction = () => {
    if (canHunterAct) {
      if (!selectedPlayer) return;
      socket.emit("hunter:shoot", selectedPlayer.id);
      return;
    }

    if (me.role === "Werewolf" || me.role === "Maid") {
      if (!selectedPlayer) return;
      socket.emit("night:action", selectedPlayer.id);
      return;
    }

    if (me.role === "Seer") {
      if (!selectedPlayer) return;
      socket.emit("seer:inspect", selectedPlayer.id);
      return;
    }

    if (me.role === "Cupid") {
      if (cupidTargets.length !== 2) return;
      socket.emit("cupid:bind", cupidTargets);
      setCupidTargets([]);
    }
  };

  const submitVote = () => {
    if (!selectedPlayer) return;
    socket.emit("vote:submit", selectedPlayer.id);
  };

  const actionTitle = canHunterAct
    ? "Choose your final shot"
    : isDead
      ? "No actions available"
      : me.role === "Werewolf"
        ? "Choose a victim"
        : me.role === "Doctor"
          ? state.doctorDecisionNeeded
            ? "Choose whether to save them"
            : "Stand by for a save decision"
          : me.role === "GirlOfTheNight"
            ? state.girlPeekActive
              ? "Wolf chat open"
              : "Open wolf chat"
            : me.role === "Dog"
              ? "Choose your faction"
              : me.role === "Cupid"
                ? cupidTargets.length === 2
                  ? "Ready to bind lovers"
                  : `Select 2 players (${cupidTargets.length}/2)`
                : me.role === "Maid"
                  ? state.myNightAction
                    ? "Role swap submitted"
                    : "Swap roles with target"
                  : inspectedRole
                    ? "Vision received"
                    : `Inspect ${selectedPlayer?.name ?? "a player"}`;

  const roleAssigned = !isLobby;
  const roleNameDisplay = roleAssigned ? me.role : "Hidden";
  const roleSummaryDisplay = roleAssigned
    ? roleSummary(me.role)
    : "Your role is not assigned yet. Roles are secretly distributed when the match starts.";
  const objectiveDisplay = roleAssigned
    ? roleObjective(me.role)
    : "Ready up and wait for the host to begin the round.";

  const renderRoleActionContent = () => {
    if (canHunterAct) {
      return (
        <>
          <p className="action-copy">
            You were eliminated, but the Hunter gets one final shot before
            leaving the village.
          </p>
          <button
            className="primary-btn"
            disabled={!selectedPlayer}
            onClick={handleRoleAction}
          >
            <Eye size={17} /> Fire at {selectedPlayer?.name ?? "a player"}
          </button>
        </>
      );
    }

    if (isDead) {
      return (
        <p className="action-copy">
          Your role has been revealed to you, but you can no longer affect the
          living village.
        </p>
      );
    }

    if (me.role === "GirlOfTheNight") {
      return (
        <>
          <p className="action-copy">
            Open or close wolf chat manually. If it stays open for more than 3
            seconds, wolves will see your highlighted card.
          </p>
          <button
            className="primary-btn"
            disabled={!isNight}
            onClick={() =>
              socket.emit(
                state.girlPeekActive ? "girl:peek:stop" : "girl:peek:start",
              )
            }
          >
            <Eye size={17} />
            {state.girlPeekActive ? "Close wolf chat" : "Open wolf chat"}
          </button>
        </>
      );
    }

    if (me.role === "Doctor") {
      const target = state.pendingDoctorTargetId
        ? state.players.find((player) => player.id === state.pendingDoctorTargetId)
        : null;

      if (!state.doctorDecisionNeeded || !target) {
        return (
          <p className="action-copy">
            Stay alert. When someone is marked to die, you will get one
            save-or-not decision for the whole match.
          </p>
        );
      }

      return (
        <>
          <p className="action-copy">
            {target.name} is marked to die ({state.pendingDoctorSource === "vote" ? "vote" : "night kill"}). Save now or let the elimination happen.
          </p>
          <div className="dual-actions">
            <button className="primary-btn" onClick={() => decideDoctor(true)}>
              <Shield size={16} /> Save {target.name}
            </button>
            <button className="secondary-btn" onClick={() => decideDoctor(false)}>
              Do not save
            </button>
          </div>
        </>
      );
    }

    if (me.role === "Dog") {
      return (
        <>
          <p className="action-copy">
            Choose your side tonight. This can reshape the game quickly.
          </p>
          <div className="dual-actions">
            <button
              className="secondary-btn"
              disabled={!isNight}
              onClick={() => socket.emit("dog:choose", "villager")}
            >
              Side with village
            </button>
            <button
              className="secondary-btn"
              disabled={!isNight}
              onClick={() => socket.emit("dog:choose", "werewolf")}
            >
              Side with wolves
            </button>
          </div>
        </>
      );
    }

    if (inspectedRole) {
      return (
        <div className="vision-result">
          <div className="vision-sigil">
            {inspectedRole === "Werewolf" ? "W" : "V"}
          </div>
          <div>
            <strong>{selectedPlayer?.name}</strong>
            <p>
              This player is a <b>{inspectedRole}</b>.
            </p>
          </div>
          <button className="reset-action" onClick={() => setSelected("")}>
            Inspect again
          </button>
        </div>
      );
    }

    return (
      <>
        <p className="action-copy">
          {me.role === "Werewolf" ||
          me.role === "Maid" ||
          me.role === "Seer" ||
          me.role === "Cupid"
            ? "Select one living player to use your role action."
            : "Watch the board and coordinate with your team."}
        </p>
        {me.role === "Cupid" && (
          <p className="action-copy">
            Selected lovers: {cupidTargets.length}/2
            {cupidTargets.length > 0
              ? ` (${cupidTargets
                  .map(
                    (id) =>
                      state?.players.find((player) => player.id === id)?.name ??
                      "Unknown",
                  )
                  .join(" + ")})`
              : ""}
          </p>
        )}
        <button
          className="primary-btn"
          disabled={
            isDead ||
            (me.role !== "Cupid" && !selectedPlayer) ||
            (me.role === "Cupid" && cupidTargets.length !== 2) ||
            (me.role === "Seer" && (!isNight || !!state.myNightAction)) ||
            (me.role === "Werewolf" && !isNight) ||
            (me.role === "Maid" && (!isNight || !!state.myNightAction)) ||
            (me.role === "Cupid" && !isNight) ||
            !["Seer", "Werewolf", "Maid", "Cupid"].includes(me.role)
          }
          onClick={handleRoleAction}
        >
          <Eye size={17} />
          {me.role === "Seer"
            ? "Inspect player"
            : me.role === "Werewolf"
              ? "Set wolf target"
              : me.role === "Maid"
                ? "Swap role"
                : me.role === "Cupid"
                  ? "Bind selected lovers"
                  : "Action unavailable"}
        </button>
      </>
    );
  };

  return (
    <main
      className={`${phase === "night" ? "app night" : phase === "day" ? "app day" : "app lobby"} ${isDead ? "spectator-mode" : ""} ${deathCause ? `death-${deathCause}` : ""}`}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Moon size={17} fill="currentColor" />
          </span>
          <span>Millers Hollow</span>
          <span className="brand-tag">ONLINE</span>
        </div>

        <div className="room-pill">
          <span className="live-dot" /> ROOM <strong>{state.room}</strong>
          <button onClick={copyRoom} aria-label="Copy room code">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>

        <div className="top-actions">
          <button
            className={`icon-btn ${audioEnabled ? "" : "muted"}`}
            onClick={toggleAudio}
            aria-label={
              audioEnabled ? "Mute event sounds" : "Enable event sounds"
            }
            title={audioEnabled ? "Mute event sounds" : "Enable event sounds"}
          >
            <Volume2 size={18} />
          </button>
        </div>
      </header>

      <section className="game-layout">
        {!connected && (
          <div className="connection-banner" role="alert">
            <span className="connection-pulse" />
            <div>
              <strong>Connection lost</strong>
              <span>
                The village is waiting. Your game state will resync when you
                reconnect.
              </span>
            </div>
            <button onClick={() => socket.connect()}>Reconnect</button>
          </div>
        )}

        {notice && (
          <div className={`game-notice notice-${notice.tone}`} role="status">
            <span className="notice-mark">
              {notice.tone === "danger"
                ? "!"
                : notice.tone === "success"
                  ? "OK"
                  : "i"}
            </span>
            <div>
              <strong>{notice.title}</strong>
              <span>{notice.detail}</span>
            </div>
            <button
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
            >
              x
            </button>
          </div>
        )}

        <aside className="left-rail">
          <div className="eyebrow">
            <span className="live-dot" />{" "}
            {isLobby
              ? "ROOM OPEN"
              : `NIGHT ${String(state.night).padStart(2, "0")}`}
          </div>

          <div className="phase-title">
            <span className="phase-icon">
              {phase === "night" ? (
                <Moon size={28} fill="currentColor" />
              ) : phase === "day" ? (
                <Sun size={28} />
              ) : (
                <Users size={28} />
              )}
            </span>
            <div>
              <h1>
                {isLobby
                  ? "Gather the village"
                  : phase === "night"
                    ? "The village sleeps"
                    : "The village wakes"}
              </h1>
              <p>
                {isLobby
                  ? "Everyone is here. Waiting for the host."
                  : phase === "night"
                    ? "Choose your target in secret."
                    : "Talk. Watch. Decide together."}
              </p>
            </div>
          </div>

          <div className="timer">
            <div>
              <span className="timer-label">
                {isLobby ? "READY PLAYERS" : "PHASE ENDS IN"}
              </span>
              <strong>
                {isLobby ? `${readyCount}/${humans.length}` : timerText}
              </strong>
            </div>
            <div className="timer-ring">
              {isLobby ? "L" : phase === "night" ? "N" : "D"}
            </div>
          </div>

          {!isLobby && (
            <div className="phase-health">
              <div className="phase-health-head">
                <span>
                  <Clock3 size={13} /> PHASE PRESSURE
                </span>
                <strong>{phaseProgress}%</strong>
              </div>
              <div className="phase-health-track">
                <span style={{ width: `${phaseProgress}%` }} />
              </div>
            </div>
          )}

          <div className={`role-card ${roleThemeClass(me.role)}`}>
            <div className="role-kicker">
              <Eye size={14} /> YOUR ROLE
              <span className={`role-tag ${roleThemeClass(me.role)}`}>
                {roleTag(me.role)}
              </span>
            </div>
            <div className="role-identity">
              <div className={`role-icon ${roleThemeClass(me.role)}`}>
                {roleGlyph(me.role)}
              </div>
              <div className="role-copy">
                <div className={`role-name ${roleAssigned ? "" : "role-hidden"}`}>
                  {roleNameDisplay}
                </div>
                <p>{roleSummaryDisplay}</p>
              </div>
            </div>
            <div className="role-secret">
              <Shield size={15} />
              <span>Only you can see this</span>
            </div>
          </div>

          <div className="objective">
            <span className="section-label">YOUR OBJECTIVE</span>
            <p>{objectiveDisplay}</p>
          </div>

          <div className="helper-panel">
            <span className="section-label">TACTICAL HINTS</span>
            <ul>
              {helperHints.map((hint, index) => (
                <li key={`${hint}-${index}`}>{hint}</li>
              ))}
            </ul>
          </div>

          {isLobby && isHost && (
            <div className="host-controls-panel">
              <span className="section-label">HOST CONTROLS</span>
              <div className="host-controls-group">
                <button
                  className="host-control-btn"
                  onClick={() => lockRoom(!(state.roomLocked ?? false))}
                  title={state.roomLocked ? "Room is locked" : "Room is open"}
                >
                  {state.roomLocked ? <Lock size={16} /> : <Unlock size={16} />}
                  <span>{state.roomLocked ? "Unlock Room" : "Lock Room"}</span>
                </button>
                <button
                  className="host-control-btn"
                  onClick={forceStart}
                  disabled={humans.length < 2}
                >
                  <Play size={16} />
                  <span>Force Start</span>
                </button>
                <button className="host-control-btn" onClick={toggleTutorial}>
                  <BookOpen size={16} />
                  <span>
                    {state.tutorialEnabled ? "Disable" : "Enable"} Tutorial
                  </span>
                </button>
              </div>
              <div className="preset-selector">
                <span className="preset-label">Role Preset</span>
                <div className="preset-buttons">
                  {(["classic", "chaos", "beginner"] as const).map((preset) => (
                    <button
                      key={preset}
                      className={`preset-btn ${presetDraft === preset ? "active" : ""}`}
                      onClick={() => setPreset(preset)}
                    >
                      {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <button className="danger-btn" onClick={endMatch}>
                <X size={16} />
                End Match
              </button>
            </div>
          )}

          {isLobby && (
            <>
              <button
                className="secondary-btn"
                onClick={() => socket.emit("room:ready", !isReady)}
              >
                {isReady ? "Unready" : "Ready up"}
                <ChevronRight size={15} />
              </button>
              {isHost && (
                <button
                  className="secondary-btn"
                  disabled={!allPlayersReady || humans.length < 2}
                  onClick={() => socket.emit("game:start")}
                >
                  <Sun size={16} />
                  {allPlayersReady
                    ? "Start game"
                    : `Waiting for ${humans.length - readyCount} more`}
                  <ChevronRight size={15} />
                </button>
              )}
            </>
          )}

          {!isLobby && isHost && !state.winner && (
            <button
              className="secondary-btn"
              disabled={isDead}
              onClick={() => socket.emit("phase:toggle")}
            >
              {phase === "night" ? <Sun size={16} /> : <Moon size={16} />}
              {phase === "night" ? "Start day phase" : "Start night phase"}
              <ChevronRight size={15} />
            </button>
          )}
        </aside>

        <section className="board-area">
          {canHunterAct && (
            <div className="hunter-urgent-panel">
              <div>
                <span className="section-label">HUNTER FINAL SHOT</span>
                <strong>
                  Select a living target now. This action is available only once.
                </strong>
              </div>
              <button
                className="primary-btn"
                disabled={!selectedPlayer}
                onClick={handleRoleAction}
              >
                <Eye size={16} />
                Fire at {selectedPlayer?.name ?? "a player"}
              </button>
            </div>
          )}

          {state.tutorialEnabled &&
            state.tutorialHint &&
            !isLobby &&
            !dismissedTutorialHint && (
              <div className="tutorial-hint-box">
                <div className="hint-icon-wrap">
                  <Lightbulb size={16} className="hint-icon" />
                </div>
                <div className="hint-content">
                  <div className="hint-header">
                    <strong>Quick hint</strong>
                    <span className="hint-chip">
                      {phase === "night" ? "Night" : "Day"}
                    </span>
                  </div>
                  <p>{state.tutorialHint}</p>
                </div>
                <button
                  onClick={() => setDismissedTutorialHint(true)}
                  aria-label="Close hint"
                >
                  <X size={16} />
                </button>
              </div>
            )}

          {isDead && (
            <div className="spectator-banner">
              <Skull size={19} />
              <div>
                <span className="section-label">
                  {canHunterAct ? "FINAL MOMENT" : "YOU ARE OUT"}
                </span>
                <strong>
                  {canHunterAct
                    ? "The Hunter gets one final shot."
                    : deathCause === "voted"
                      ? "The village voted against you."
                      : "The night claimed you."}
                </strong>
                <p>
                  {canHunterAct
                    ? "Choose one living player before you leave the village."
                    : "You can watch the village, but your actions are locked."}
                </p>
              </div>
            </div>
          )}

          {isLobby && (
            <div className="lobby-banner">
              <span className="winner-sigil">L</span>
              <div>
                <span className="section-label">WAITING ROOM</span>
                <strong>
                  {isHost
                    ? "You are the host."
                    : "Waiting for the host to start."}
                </strong>
                <p>
                  {isHost
                    ? `Ready up the village: ${readyCount}/${humans.length} players ready.`
                    : `The host is waiting for the full room: ${readyCount}/${humans.length} ready.`}
                </p>
              </div>
            </div>
          )}

          {isLobby && (
            <div className="lobby-action-bar">
              <button
                className={`primary-btn ready-cta ${isReady ? "is-ready" : ""}`}
                onClick={() => socket.emit("room:ready", !isReady)}
              >
                <Users size={17} />
                {isReady ? "You are Ready - Click to Unready" : "Ready Up Now"}
              </button>
              {isHost && (
                <button
                  className="secondary-btn host-start-cta"
                  disabled={!allPlayersReady || humans.length < 2}
                  onClick={() => socket.emit("game:start")}
                >
                  <Sun size={16} />
                  {allPlayersReady
                    ? "Start Match"
                    : `Need ${Math.max(0, humans.length - readyCount)} more ready`}
                </button>
              )}
            </div>
          )}

          {state.winner && (
            <div className="winner-banner">
              <span className="winner-sigil">
                {state.winner === "village" ? "V" : "W"}
              </span>
              <div>
                <span className="section-label">GAME OVER</span>
                <strong>
                  {state.winner === "village"
                    ? "The village survives."
                    : "The werewolves take the village."}
                </strong>
                {state.lastEvent?.detail && (
                  <p className="winner-detail">{state.lastEvent.detail}</p>
                )}
              </div>
              {isHost && (
                <button
                  className="rematch-btn"
                  onClick={() => socket.emit("game:reset")}
                >
                  Play again
                </button>
              )}
            </div>
          )}

          {state.winner && showSummary && (
            <div
              className="summary-modal-overlay"
              onClick={() => setShowSummary(false)}
            >
              <div
                className="summary-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="summary-header">
                  <h2>Game Summary</h2>
                  <button
                    onClick={() => setShowSummary(false)}
                    aria-label="Close summary"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="summary-content">
                  {state.nightHistory && state.nightHistory.length > 0 && (
                    <div className="summary-section">
                      <h3>
                        <Moon size={16} /> Night-by-Night Timeline
                      </h3>
                      <div className="timeline">
                        {state.nightHistory.map((night) => (
                          <div
                            key={`night-${night.night}`}
                            className="timeline-entry"
                          >
                            <div className="timeline-label">
                              Night {String(night.night).padStart(2, "0")}
                            </div>
                            <div className="timeline-events">
                              {night.victim && (
                                <div className="timeline-event victim">
                                  <Skull size={14} />
                                  <span>
                                    {night.victim.name} ({night.victim.role})
                                    was eliminated
                                  </span>
                                </div>
                              )}
                              {night.protected && (
                                <div className="timeline-event protected">
                                  <Shield size={14} />
                                  <span>
                                    {night.protected.name} was protected
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {state.voteHistory && state.voteHistory.length > 0 && (
                    <div className="summary-section">
                      <h3>
                        <Users size={16} /> Vote History
                      </h3>
                      <div className="vote-summary">
                        {state.voteHistory.map((voteRecord) => (
                          <div
                            key={`vote-${voteRecord.phase}`}
                            className="vote-entry"
                          >
                            <div className="vote-result">
                              <span className="vote-label">
                                Day {String(voteRecord.phase).padStart(2, "0")}
                              </span>
                              <span className="voted-out">
                                {voteRecord.votedOut.name} (
                                {voteRecord.votedOut.role}) was eliminated
                              </span>
                            </div>
                            <div className="votes-cast">
                              {Object.entries(voteRecord.votes).map(
                                ([voter, target]) => (
                                  <div
                                    key={`${voter}-${target}`}
                                    className="vote-cast"
                                  >
                                    <span className="voter">
                                      {state.players.find((p) => p.id === voter)
                                        ?.name ?? "Unknown"}
                                    </span>
                                    <span className="arrow">→</span>
                                    <span className="votee">
                                      {state.players.find(
                                        (p) => p.id === target,
                                      )?.name ?? "Unknown"}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="summary-section">
                    <h3>
                      <Eye size={16} /> Final Roles Revealed
                    </h3>
                    <div className="roles-grid">
                      {state.players.map((player) => (
                        <div key={player.id} className="role-reveal">
                          <div className="reveal-info">
                            <strong>{player.name}</strong>
                            <span
                              className={`reveal-role ${player.alive ? "alive" : "dead"}`}
                            >
                              {meOrNull && meOrNull.id === player.id
                                ? `You (${meOrNull.role})`
                                : state.winner && player.role
                                  ? player.role
                                  : player.alive
                                    ? "Survived"
                                    : "Eliminated"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="summary-footer">
                  {isHost && (
                    <button
                      className="primary-btn"
                      onClick={() => {
                        setShowSummary(false);
                        socket.emit("game:reset");
                      }}
                    >
                      <Sun size={16} />
                      Start New Game
                    </button>
                  )}
                  <button
                    className="secondary-btn"
                    onClick={() => setShowSummary(false)}
                  >
                    Close Summary
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="feedback-strip">
            <div className="feedback-chip">
              <Sparkles size={14} />
              <span>{me.alive ? "Alive" : "Eliminated"}</span>
            </div>
            <div className="feedback-chip">
              <Users size={14} />
              <span>{livingCount} active players</span>
            </div>
            <div className="feedback-chip">
              <AlertTriangle size={14} />
              <span>
                {state.myVote
                  ? "Vote locked"
                  : isDay
                    ? "Vote pending"
                    : "Night focus"}
              </span>
            </div>
          </div>

          <div className="live-status-card">
            <div className="live-status-head">
              <span className="section-label">LIVE STATUS</span>
              <strong>
                {isLobby ? "Lobby" : isNight ? "Night Phase" : "Day Phase"}
              </strong>
            </div>
            <p>
              {isDead
                ? canHunterAct
                  ? "You are eliminated but can still fire one final Hunter shot."
                  : "You are eliminated and now spectating this round."
                : state.myNightAction && (me.role === "Werewolf" || me.role === "Doctor")
                  ? "Your target is set. You can still change it before night ends."
                  : state.myNightAction
                    ? "Your night action is locked in. Waiting for others."
                  : state.myVote
                    ? "Your vote is locked. Wait for the village to finish voting."
                    : "Choose your action and keep watching player behavior."}
            </p>
          </div>

          <div className="board-heading">
            <div>
              <span className="eyebrow">LIVE VILLAGE</span>
              <h2>Who is still standing?</h2>
            </div>
            <div className="player-count">
              <Users size={16} /> <strong>{livingCount}</strong> alive{" "}
              <span>/</span> {state.players.length} total
            </div>
          </div>

          <div className="roster">
            {state.players.map((player) => {
              const isPlayerReady = state.readyIds.includes(player.id);
              const watched = Boolean(
                state.wolfWatchedIds?.includes(player.id),
              );
              const isLover = Boolean(state.lovers?.includes(player.id));
              return (
                <button
                  key={player.id}
                  className={`player-tile ${selected === player.id ? "selected" : ""} ${!player.alive ? "dead" : ""} ${player.id === me.id ? "self" : ""} ${watched ? "watched" : ""} ${isLover ? "lover" : ""}`}
                  onClick={() => {
                    if (!player.alive || player.id === me.id) return;

                    if (me.role === "Cupid" && isNight) {
                      setCupidTargets((current) => {
                        if (current.includes(player.id)) {
                          return current.filter((id) => id !== player.id);
                        }
                        if (current.length >= 2) {
                          return [current[1], player.id];
                        }
                        return [...current, player.id];
                      });
                      return;
                    }

                    setSelected(player.id);
                  }}
                  disabled={!player.alive}
                >
                  <div className="avatar">
                    {player.name.slice(0, 2).toUpperCase()}
                    {player.alive && <span className="status-dot" />}
                  </div>
                  <div className="player-info">
                    <strong>{player.name}</strong>
                    <span>
                      {player.id === me.id
                        ? "That is you"
                        : player.alive
                          ? isLobby
                            ? isPlayerReady
                              ? "Ready to play"
                              : "Waiting in lobby"
                            : "In the village"
                          : `Eliminated (${player.role ?? "Unknown"})`}
                    </span>
                  </div>
                  {isLobby && (
                    <span
                      className={`ready-pill ${isPlayerReady ? "ready" : "waiting"}`}
                    >
                      {isPlayerReady ? "READY" : "WAITING"}
                    </span>
                  )}
                  {isDay && player.alive && state.voteCounts[player.id] > 0 && (
                    <span className="vote-count">
                      {state.voteCounts[player.id]} vote
                      {state.voteCounts[player.id] === 1 ? "" : "s"}
                    </span>
                  )}
                  {isLover && <span className="lover-heart" aria-label="Lover">♥</span>}
                  {player.id === me.id ? (
                    <span className="you-label">YOU</span>
                  ) : me.role === "Cupid" && cupidTargets.includes(player.id) ? (
                    <span className="target-mark">LOVER</span>
                  ) : !player.alive ? (
                    <Skull size={16} className="skull" />
                  ) : (
                    <span className="target-mark">
                      {selected === player.id ? "TARGET" : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {isDay && !state.winner && (
            <div className="action-panel vote-panel">
              <div className="action-head">
                <div>
                  <span className="section-label">DAY VOTE</span>
                  <h3>{state.myVote ? "Vote submitted" : `Accuse ${selectedPlayer?.name ?? "a player"}`}</h3>
                </div>
                <div className="action-badge">
                  <Users size={15} /> PUBLIC
                </div>
              </div>
              <div className="vote-progress">
                <div className="vote-progress-label">
                  <span>
                    {voteTotal} of {livingCount} votes cast
                  </span>
                  <span>
                    {voteTotal === livingCount
                      ? "Resolving..."
                      : "Waiting for the village"}
                  </span>
                </div>
                <div className="vote-progress-track">
                  <span
                    style={{
                      width: `${livingCount ? (voteTotal / livingCount) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <p className="action-copy">
                {livingCount <= 5
                  ? "Endgame rule: every remaining player must vote before night can begin."
                  : "Early game: voting is optional, and the day can end without a full vote."}
              </p>
              <button
                className="primary-btn"
                disabled={isDead || !selectedPlayer || !!state.myVote}
                onClick={submitVote}
              >
                <Users size={17} />
                {isDead
                  ? "Spectating"
                  : state.myVote
                    ? `Voted for ${state.players.find((player) => player.id === state.myVote)?.name ?? "a player"}`
                    : "Submit vote"}
              </button>
            </div>
          )}

          {!isLobby && (
            <div className="action-panel">
              <div className="action-head">
                <div>
                  <span className="section-label">
                    {me.role.toUpperCase()} ACTION
                  </span>
                  <h3>{actionTitle}</h3>
                </div>
                <div className="action-badge">
                  <Eye size={15} /> SECRET
                </div>
              </div>
              {renderRoleActionContent()}
            </div>
          )}

          <div className="event-log-panel">
            <div className="log-row">
              <ScrollText size={16} />
              <span>
                <b>Game log</b> · Night {String(state.night).padStart(2, "0")}
              </span>
              <ChevronRight size={15} />
            </div>
            <ul>
              {recentSystemEvents.map((event, index) => (
                <li key={`${event.time}-${index}`}>
                  <span>{event.time}</span>
                  <p>{event.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="chat-panel">
          <div className="chat-head">
            <div>
              <span className="section-label">VILLAGE CHAT</span>
              <h2>
                Town square{" "}
                <span className="online-count">
                  {state.players.length} online
                </span>
              </h2>
            </div>
          </div>

          <div className="chat-messages">
            {state.messages.map((message, index) => (
              <div
                className={`message ${message.system ? "system-message" : ""}`}
                key={`${message.time}-${index}`}
              >
                <div className="message-meta">
                  <strong>{message.name}</strong>
                  <span>{message.time}</span>
                </div>
                <p>{message.text}</p>
              </div>
            ))}
            <div ref={villageChatEndRef} />
          </div>

          <div className="chat-compose">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && sendMessage()}
              placeholder="Say something to the village..."
            />
            <button onClick={sendMessage} aria-label="Send message">
              <Send size={17} />
            </button>
          </div>

          <div className="chat-foot">
            <DoorOpen size={14} /> Room is invite-only <span>·</span>{" "}
            <button onClick={copyRoom}>Invite players</button>
          </div>

          {state.wolfChatVisible && (
            <div className="wolf-chat-box">
              <div className="chat-head">
                <div>
                  <span className="section-label">WOLF CHAT</span>
                  <h2>
                    Pack whisper{" "}
                    <span className="online-count">
                      {state.wolfChatMessages?.length ?? 0} messages
                    </span>
                  </h2>
                </div>
                <Eye size={17} />
              </div>

              <div className="chat-messages compact">
                {(state.wolfChatMessages ?? []).map((message, index) => (
                  <div
                    className={`message system-message ${message.wolf ? "wolf-message" : "guest-wolf-message"}`}
                    key={`${message.time}-wolf-${index}`}
                  >
                    <div className="message-meta">
                      <strong>
                        {message.wolf ? "[WOLF] " : "[PEEK] "}
                        {message.name}
                      </strong>
                      <span>{message.time}</span>
                    </div>
                    <p>{message.text}</p>
                  </div>
                ))}
                <div ref={wolfChatEndRef} />
              </div>

              <div className="chat-compose">
                <input
                  value={wolfDraft}
                  onChange={(event) => setWolfDraft(event.target.value)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && sendWolfMessage()
                  }
                  placeholder="Send a wolf-only message..."
                />
                <button
                  onClick={sendWolfMessage}
                  aria-label="Send wolf-only message"
                >
                  <Send size={17} />
                </button>
              </div>
            </div>
          )}
        </aside>
      </section>

      {!isLobby && (
        <>
          <button
            className="mobile-action-toggle"
            onClick={() => setMobileActionsOpen((open) => !open)}
          >
            <Shield size={16} />
            {mobileActionsOpen ? "Close Actions" : "Open Actions"}
          </button>
          <div
            className={`mobile-action-drawer ${mobileActionsOpen ? "open" : ""}`}
          >
            <div className="mobile-action-head">
              <strong>{me.role} Action</strong>
              <button onClick={() => setMobileActionsOpen(false)}>Close</button>
            </div>
            <p className="mobile-action-subtitle">{actionTitle}</p>
            <div className="mobile-action-content">
              {renderRoleActionContent()}
            </div>
          </div>
        </>
      )}

      <footer className="footer">
        <span>Millers Hollow Online</span>
        <span>
          Room host: <b>{isHost ? "You" : "Another player"}</b>
        </span>
        <span className={`connection ${connected ? "" : "offline"}`}>
          <span className="live-dot" /> {connected ? "Connected" : "Offline"}
        </span>
      </footer>
    </main>
  );
}

export default App;
