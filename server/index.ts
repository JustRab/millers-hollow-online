import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 3001);
const DIST_DIR = join(process.cwd(), "dist");
const DEFAULT_ROOM = "MILL-7Q2";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

type Phase = "lobby" | "night" | "day";
type Role =
  | "Seer"
  | "Werewolf"
  | "Villager"
  | "Doctor"
  | "Hunter"
  | "Dog"
  | "GirlOfTheNight"
  | "Cupid"
  | "Maid";
type Tone = "info" | "danger" | "success";

type Player = {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
  sessionToken?: string;
};

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
  tone: Tone;
};

type RolePreset = "classic" | "chaos" | "beginner";

type SessionRecord = {
  playerId: string;
  roomCode: string;
  playerName: string;
  expiresAt: number;
};

type NightHistory = {
  night: number;
  victim: { id: string; name: string; role: Role } | null;
  protected: { id: string; name: string } | null;
  wolfVotes: Map<string, string>;
};

type VoteHistory = {
  phase: number;
  votedOut: { id: string; name: string; role: Role };
  votes: Map<string, string>;
};

type RoomState = {
  players: Player[];
  phase: Phase;
  night: number;
  hostId: string;
  winner: "village" | "werewolves" | null;
  phaseEndsAt: number;
  pendingHunterId: string | null;
  pendingDoctorTargetId: string | null;
  pendingDoctorSource: "night" | "vote" | null;
  eventId: number;
  lastEvent: GameEvent | null;
  messages: Message[];
  inspections: Map<string, Map<string, Role>>;
  votes: Map<string, string>;
  voteRevealUntil: number;
  nightActions: Map<string, string>;
  readyPlayers: Set<string>;
  wolfChatMessages: Message[];
  girlPeekActive: boolean;
  girlPeekExpiresAt: number;
  girlPeekStartedAt: number;
  girlOfTheNightId: string | null;
  lovers: string[];
  doctorUsedIds: Set<string>;
  cupidUsedIds: Set<string>;
  maidUsed: boolean;
  revealedRoleIds: Set<string>;
  rolePreset: RolePreset;
  roomLocked: boolean;
  tutorialEnabled: boolean;
  nightHistory: NightHistory[];
  voteHistory: VoteHistory[];
};

const roomStates = new Map<string, RoomState>();
const sessionStore = new Map<string, SessionRecord>();

function generateSessionToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, record] of sessionStore.entries()) {
    if (now >= record.expiresAt) {
      sessionStore.delete(token);
    }
  }
}

function createSessionToken(
  playerId: string,
  roomCode: string,
  playerName: string,
): string {
  const token = generateSessionToken();
  sessionStore.set(token, {
    playerId,
    roomCode,
    playerName,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute expiry
  });
  return token;
}

const now = () =>
  new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function createRoomState(): RoomState {
  return {
    players: [],
    phase: "lobby",
    night: 0,
    hostId: "",
    winner: null,
    phaseEndsAt: 0,
    pendingHunterId: null,
    pendingDoctorTargetId: null,
    pendingDoctorSource: null,
    eventId: 0,
    lastEvent: null,
    messages: [
      {
        name: "System",
        text: "A hush settles over Millers Hollow.",
        time: now(),
        system: true,
      },
    ],
    inspections: new Map(),
    votes: new Map(),
    voteRevealUntil: 0,
    nightActions: new Map(),
    readyPlayers: new Set(),
    wolfChatMessages: [],
    girlPeekActive: false,
    girlPeekExpiresAt: 0,
    girlPeekStartedAt: 0,
    girlOfTheNightId: null,
    lovers: [],
    doctorUsedIds: new Set(),
    cupidUsedIds: new Set(),
    maidUsed: false,
    revealedRoleIds: new Set(),
    rolePreset: "classic",
    roomLocked: false,
    tutorialEnabled: true,
    nightHistory: [],
    voteHistory: [],
  };
}

function cloneRoom(room: RoomState): RoomState {
  return {
    ...room,
    players: room.players.map((player) => ({ ...player })),
    messages: room.messages.map((message) => ({ ...message })),
    inspections: new Map(
      [...room.inspections].map(([id, map]) => [id, new Map(map)]),
    ),
    votes: new Map(room.votes),
    voteRevealUntil: room.voteRevealUntil,
    nightActions: new Map(room.nightActions),
    pendingDoctorTargetId: room.pendingDoctorTargetId,
    pendingDoctorSource: room.pendingDoctorSource,
    readyPlayers: new Set(room.readyPlayers),
    wolfChatMessages: room.wolfChatMessages.map((message) => ({ ...message })),
    girlPeekStartedAt: room.girlPeekStartedAt,
    lovers: [...room.lovers],
    doctorUsedIds: new Set(room.doctorUsedIds),
    cupidUsedIds: new Set(room.cupidUsedIds),
    maidUsed: room.maidUsed,
    revealedRoleIds: new Set(room.revealedRoleIds),
    lastEvent: room.lastEvent ? { ...room.lastEvent } : null,
    nightHistory: room.nightHistory.map((nh) => ({
      ...nh,
      wolfVotes: new Map(nh.wolfVotes),
    })),
    voteHistory: room.voteHistory.map((vh) => ({
      ...vh,
      votes: new Map(vh.votes),
    })),
  };
}

function getRoom(roomCode: string): RoomState {
  const existing = roomStates.get(roomCode);
  if (existing) return existing;
  const created = createRoomState();
  roomStates.set(roomCode, created);
  return created;
}

function setLastEvent(
  room: RoomState,
  title: string,
  detail: string,
  tone: Tone,
) {
  room.eventId += 1;
  room.lastEvent = { id: room.eventId, title, detail, tone };
}

function getTutorialHint(phase: Phase, role: Role, night: number): string {
  if (phase === "lobby")
    return "Click Ready, then wait for the host to start the game.";
  if (phase === "night") {
    if (role === "Werewolf")
      return "Choose a target to attack. Majority vote decides the victim.";
    if (role === "Doctor")
      return "Mark a player to save once if they are attacked or voted out.";
    if (role === "Seer") return "Inspect a player to learn their role.";
    if (role === "Dog") return "Choose your allegiance: villager or werewolf.";
    if (role === "GirlOfTheNight")
      return "Peek into wolf chat. Wolves only see the eye icon after 3 seconds.";
    if (role === "Cupid")
      return "Bind two players with love. They will die together.";
    if (role === "Maid") return "Swap roles with another player in secret.";
    return "Wait for the wolves to act. You can chat if alive.";
  }
  // day phase
  if (role === "Hunter" && night === 0)
    return "You were voted out! Take your final shot on anyone.";
  return "Discuss and vote to eliminate someone. Majority decides the outcome.";
}

function getCurrentHint(room: RoomState, playerId: string): string {
  if (room.phase === "lobby")
    return "Click Ready when you are prepared to play.";
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return "";
  return getTutorialHint(room.phase, player.role, room.night);
}

function addRoomMessage(room: RoomState, message: Message) {
  room.messages.push(message);
  if (room.messages.length > 220) {
    room.messages = room.messages.slice(-220);
  }
}

function addWolfMessage(room: RoomState, message: Message) {
  room.wolfChatMessages.push(message);
  if (room.wolfChatMessages.length > 140) {
    room.wolfChatMessages = room.wolfChatMessages.slice(-140);
  }
}

function wolvesReveal(room: RoomState) {
  const wolves = room.players.filter((player) => player.role === "Werewolf");
  if (wolves.length === 0) return "No werewolves remained.";
  return `Wolves were: ${wolves.map((player) => player.name).join(", ")}.`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function assignRoles(room: RoomState) {
  const humans = room.players.filter((player) => !player.id.endsWith("-bot"));
  const total = humans.length;
  if (total < 2) return;

  const roles: Role[] = [];

  if (room.rolePreset === "beginner") {
    // Beginner: wolves, seer, doctor, villagers only
    const wolfCount = Math.max(1, Math.floor(total / 5));
    for (let i = 0; i < wolfCount; i++) roles.push("Werewolf");
    if (total >= 3) roles.push("Seer");
    if (total >= 4) roles.push("Doctor");
    while (roles.length < total) roles.push("Villager");
  } else if (room.rolePreset === "chaos") {
    // Chaos: all roles, aggressive distribution
    const wolfCount = Math.max(1, Math.floor(total / 5));
    for (let i = 0; i < wolfCount; i++) roles.push("Werewolf");
    if (total >= 3) roles.push("Seer");
    if (total >= 4) roles.push("Doctor");
    if (total >= 5) roles.push("Hunter");
    if (total >= 6) roles.push("Dog");
    if (total >= 7) roles.push("GirlOfTheNight");
    if (total >= 8) roles.push("Cupid");
    if (total >= 9) roles.push("Maid");
    while (roles.length < total) roles.push("Villager");
  } else {
    // Classic: balanced distribution
    const wolfCount = Math.max(1, Math.floor(total / 5));
    for (let i = 0; i < wolfCount; i++) roles.push("Werewolf");
    if (total >= 3) roles.push("Seer");
    if (total >= 4) roles.push("Doctor");
    if (wolfCount >= 2 && total >= 5) roles.push("Hunter");
    if (total >= 10) roles.push("Dog");
    if (total >= 6) roles.push("GirlOfTheNight");
    if (total >= 7) roles.push("Cupid");
    if (total >= 8) roles.push("Maid");
    while (roles.length < total) roles.push("Villager");
  }

  const randomizedPlayers = shuffle(humans);
  const randomizedRoles = shuffle(roles);
  randomizedPlayers.forEach((player, index) => {
    player.role = randomizedRoles[index] ?? "Villager";
    player.alive = true;
  });

  room.girlOfTheNightId =
    room.players.find((player) => player.role === "GirlOfTheNight")?.id ?? null;
}

function aliveWolves(room: RoomState) {
  return room.players.filter(
    (player) => player.alive && player.role === "Werewolf",
  );
}

function aliveVillagers(room: RoomState) {
  return room.players.filter(
    (player) => player.alive && player.role !== "Werewolf",
  );
}

function applyLoverLinkDeath(room: RoomState, deadId: string) {
  if (!room.lovers.includes(deadId)) return;
  const partnerId = room.lovers.find((id) => id !== deadId);
  if (!partnerId) return;

  const partner = room.players.find((player) => player.id === partnerId);
  if (!partner || !partner.alive) return;

  partner.alive = false;
  addRoomMessage(room, {
    name: "System",
    text: `${partner.name} died from heartbreak after their lover fell. Role: ${partner.role}.`,
    time: now(),
    system: true,
  });
  setLastEvent(
    room,
    "A tragic bond",
    `${partner.name} could not survive their lover's death. Role: ${partner.role}.`,
    "danger",
  );
}

function checkWinner(room: RoomState) {
  const wolves = aliveWolves(room).length;
  const villagers = aliveVillagers(room).length;

  if (wolves === 0) {
    room.winner = "village";
    setLastEvent(
      room,
      "The village wins",
      `Every werewolf has been eliminated. ${wolvesReveal(room)}`,
      "success",
    );
    return true;
  }

  if (wolves >= villagers) {
    room.winner = "werewolves";
    setLastEvent(
      room,
      "The werewolves win",
      `The wolves now control the village. ${wolvesReveal(room)}`,
      "danger",
    );
    return true;
  }

  return false;
}

function publicPlayers(room: RoomState) {
  return room.players.map(({ id, name, alive, role }) =>
    room.winner || !alive || room.revealedRoleIds.has(id)
      ? { id, name, alive, role }
      : { id, name, alive },
  );
}

function voteCounts(room: RoomState) {
  const tally = new Map<string, number>();
  for (const [voterId, targetId] of room.votes.entries()) {
    const voter = room.players.find((player) => player.id === voterId);
    if (!voter || voter.role === "GirlOfTheNight") continue;
    tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }
  return Object.fromEntries(tally);
}

function resolveWolfVictim(room: RoomState): string | undefined {
  const aliveWolfIds = new Set(aliveWolves(room).map((player) => player.id));
  const tally = new Map<string, number>();

  for (const [actorId, targetId] of room.nightActions.entries()) {
    if (!aliveWolfIds.has(actorId)) continue;
    tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0];
}

function collectWolfVotes(room: RoomState) {
  const wolfVotes = new Map<string, string>();
  for (const [actorId, targetId] of room.nightActions.entries()) {
    const actor = room.players.find((p) => p.id === actorId);
    if (actor?.role === "Werewolf") wolfVotes.set(actorId, targetId);
  }
  return wolfVotes;
}

function setDoctorPrompt(
  room: RoomState,
  targetId: string,
  source: "night" | "vote",
) {
  room.pendingDoctorTargetId = targetId;
  room.pendingDoctorSource = source;
  room.phaseEndsAt = Date.now() + 20_000;

  const target = room.players.find((player) => player.id === targetId);
  setLastEvent(
    room,
    "Doctor decision",
    target
      ? `Doctor must choose whether to save ${target.name}.`
      : "Doctor must choose whether to save the target.",
    "info",
  );
}

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "millers-hollow" }));
    return;
  }

  if (request.method !== "GET" || !existsSync(join(DIST_DIR, "index.html"))) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
  const relativePath =
    requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const candidate = join(DIST_DIR, relativePath);
  const filePath =
    existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(DIST_DIR, "index.html");
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  response.writeHead(200, {
    "content-type": contentTypes[extension] ?? "application/octet-stream",
  });
  response.end(readFileSync(filePath));
});

const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN ?? true },
});

function emitState(roomCode: string) {
  const room = getRoom(roomCode);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.room !== roomCode) continue;

    const me = room.players.find((player) => player.id === socket.id);
    const canSeeWolfChat = Boolean(
      me &&
      room.phase === "night" &&
      (me.role === "Werewolf" ||
        (me.role === "GirlOfTheNight" && room.girlPeekActive)),
    );

    const watchedIds =
      me?.role === "Werewolf" &&
      room.girlPeekActive &&
      Date.now() - room.girlPeekStartedAt >= 3_000
      && room.girlPeekExpiresAt > Date.now()
      ? room.girlOfTheNightId
        ? [room.girlOfTheNightId]
        : []
      : [];

    const tutorialHint =
      room.tutorialEnabled && room.phase !== "lobby"
        ? getCurrentHint(room, socket.id)
        : "";
    const sessionToken = me?.sessionToken ?? "";

    socket.emit("game:state", {
      room: roomCode,
      phase: room.phase,
      phaseEndsAt: room.phaseEndsAt,
      pendingHunterId: room.pendingHunterId,
      pendingDoctorTargetId: room.pendingDoctorTargetId,
      pendingDoctorSource: room.pendingDoctorSource,
      doctorDecisionNeeded: Boolean(
        me &&
          me.role === "Doctor" &&
          me.alive &&
          room.pendingDoctorTargetId &&
          !room.doctorUsedIds.has(me.id),
      ),
      readyIds: [...room.readyPlayers],
      night: room.night,
      hostId: room.hostId,
      winner: room.winner,
      lastEvent: room.lastEvent,
      players: publicPlayers(room),
      me: me
        ? { id: me.id, name: me.name, role: me.role, alive: me.alive }
        : null,
      inspections: Object.fromEntries(room.inspections.get(socket.id) ?? []),
      myVote: room.phase === "day" ? (room.votes.get(socket.id) ?? null) : null,
      voteCounts: room.phase === "day" ? voteCounts(room) : {},
      votedIds:
        room.phase === "day" ? [...room.votes.keys()] : [],
      voteRevealUntil: room.voteRevealUntil,
      lovers: [...room.lovers],
      myNightAction: room.nightActions.get(socket.id) ?? null,
      roleActionUnavailable: Boolean(
        me &&
          ((me.role === "Cupid" && room.cupidUsedIds.has(me.id)) ||
            (me.role === "Maid" && room.maidUsed)),
      ),
      messages: room.messages,
      wolfChatMessages: canSeeWolfChat ? room.wolfChatMessages : [],
      wolfChatVisible: canSeeWolfChat,
      girlPeekActive: room.girlPeekActive,
      wolfWatchedIds: watchedIds,
      rolePreset: room.rolePreset,
      roomLocked: room.roomLocked,
      tutorialEnabled: room.tutorialEnabled,
      tutorialHint,
      sessionToken,
      nightHistory: room.nightHistory,
      voteHistory: room.voteHistory,
    });
  }
}

function resolveDayVote(roomCode: string) {
  const room = getRoom(roomCode);
  room.voteRevealUntil = 0;

  const totals = new Map<string, number>();
  for (const [voterId, votedId] of room.votes.entries()) {
    const voter = room.players.find((player) => player.id === voterId);
    if (!voter || voter.role === "GirlOfTheNight") continue;
    totals.set(votedId, (totals.get(votedId) ?? 0) + 1);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const highest = ranked[0]?.[1] ?? 0;
  const tied = ranked.filter(([, count]) => count === highest).length > 1;

  if (!tied && ranked[0]) {
    const eliminated = room.players.find(
      (player) => player.id === ranked[0][0],
    );
    if (eliminated && eliminated.alive) {
      const doctor = room.players.find(
        (player) => player.alive && player.role === "Doctor",
      );
      const doctorCanDecide =
        doctor &&
        !room.doctorUsedIds.has(doctor.id) &&
        room.pendingDoctorTargetId === null;

      if (doctorCanDecide) {
        setDoctorPrompt(room, eliminated.id, "vote");
        emitState(roomCode);
        return;
      }

      eliminated.alive = false;
      room.revealedRoleIds.add(eliminated.id);
      addRoomMessage(room, {
        name: "System",
        text: `${eliminated.name} was voted out by the village. Role: ${eliminated.role}.`,
        time: now(),
        system: true,
      });
      setLastEvent(
        room,
        `${eliminated.name} was voted out`,
        `The village made its choice. Role: ${eliminated.role}.`,
        "danger",
      );
      applyLoverLinkDeath(room, eliminated.id);
      room.voteHistory.push({
        phase: room.night,
        votedOut: {
          id: eliminated.id,
          name: eliminated.name,
          role: eliminated.role,
        },
        votes: new Map(room.votes),
      });

      if (eliminated.role === "Hunter" && io.sockets.sockets.has(eliminated.id)) {
        room.pendingHunterId = eliminated.id;
        room.phaseEndsAt = Date.now() + 30_000;
        room.votes.clear();
        emitState(roomCode);
        return;
      }
    }
  } else {
    addRoomMessage(room, {
      name: "System",
      text: "The vote was tied. Nobody was eliminated.",
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      "The vote was tied",
      "Nobody was eliminated. The night continues.",
      "info",
    );
  }

  room.votes.clear();
  if (!checkWinner(room)) {
    room.phase = "night";
    room.night += 1;
    room.phaseEndsAt = Date.now() + 120_000;
  }
  emitState(roomCode);
}

function resolveNight(roomCode: string) {
  const room = getRoom(roomCode);

  const doctor = room.players.find(
    (player) => player.alive && player.role === "Doctor",
  );
  const victimId = resolveWolfVictim(room);
  const wolfVotes = collectWolfVotes(room);

  const victim = victimId
    ? room.players.find((player) => player.id === victimId)
    : null;

  if (victim && victim.alive) {
    const doctorCanDecide =
      doctor && !room.doctorUsedIds.has(doctor.id) && room.pendingDoctorTargetId === null;

    if (doctorCanDecide) {
      setDoctorPrompt(room, victim.id, "night");
      emitState(roomCode);
      return;
    }

    victim.alive = false;
    room.revealedRoleIds.add(victim.id);

    addRoomMessage(room, {
      name: "System",
      text: `${victim.name} did not survive the night. Role: ${victim.role}.`,
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      `${victim.name} died during the night`,
      `The village wakes to a missing voice. Role: ${victim.role}.`,
      "danger",
    );

    applyLoverLinkDeath(room, victim.id);

    room.nightHistory.push({
      night: room.night,
      victim: { id: victim.id, name: victim.name, role: victim.role },
      protected: null,
      wolfVotes,
    });

    if (victim.role === "Hunter" && io.sockets.sockets.has(victim.id)) {
      room.pendingHunterId = victim.id;
      room.phaseEndsAt = Date.now() + 30_000;
      emitState(roomCode);
      return;
    }
  } else {
    addRoomMessage(room, {
      name: "System",
      text: "The village wakes. Nobody was lost in the night.",
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      "Nobody was lost",
      "No one was eliminated during the night.",
      "success",
    );
    room.nightHistory.push({
      night: room.night,
      victim: null,
      protected: null,
      wolfVotes,
    });
  }
  room.nightActions.clear();
  room.wolfChatMessages = [];
  room.girlPeekActive = false;
  room.girlPeekExpiresAt = 0;
  room.girlPeekStartedAt = 0;

  if (!checkWinner(room)) {
    room.phase = "day";
    room.phaseEndsAt = Date.now() + 180_000;
  }

  emitState(roomCode);
}

function resolveExpiredPhases() {
  for (const roomCode of roomStates.keys()) {
    const room = getRoom(roomCode);

    if (room.girlPeekActive) {
      const currentTime = Date.now();
      if (!room.girlPeekExpiresAt && currentTime - room.girlPeekStartedAt >= 3_000) {
        room.girlPeekExpiresAt = room.girlPeekStartedAt + 6_000;
        emitState(roomCode);
      } else if (room.girlPeekExpiresAt && currentTime >= room.girlPeekExpiresAt) {
        room.girlPeekExpiresAt = -1;
        emitState(roomCode);
      }
    }

    if (room.voteRevealUntil) {
      if (Date.now() < room.voteRevealUntil) continue;
      resolveDayVote(roomCode);
      continue;
    }

    if (room.pendingDoctorTargetId) {
      if (Date.now() < room.phaseEndsAt) continue;

      const target = room.players.find(
        (player) => player.id === room.pendingDoctorTargetId,
      );

      if (room.pendingDoctorSource === "night") {
        const wolfVotes = collectWolfVotes(room);
        if (target && target.alive) {
          target.alive = false;
          room.revealedRoleIds.add(target.id);
          addRoomMessage(room, {
            name: "System",
            text: `${target.name} did not survive the night. Role: ${target.role}.`,
            time: now(),
            system: true,
          });
          setLastEvent(
            room,
            `${target.name} died during the night`,
            `The Doctor did not save ${target.name}. Role: ${target.role}.`,
            "danger",
          );
          applyLoverLinkDeath(room, target.id);
          room.nightHistory.push({
            night: room.night,
            victim: { id: target.id, name: target.name, role: target.role },
            protected: null,
            wolfVotes,
          });

          if (target.role === "Hunter" && io.sockets.sockets.has(target.id)) {
            room.pendingDoctorTargetId = null;
            room.pendingDoctorSource = null;
            room.pendingHunterId = target.id;
            room.phaseEndsAt = Date.now() + 30_000;
            emitState(roomCode);
            continue;
          }
        } else {
          room.nightHistory.push({
            night: room.night,
            victim: null,
            protected: null,
            wolfVotes,
          });
        }

        room.pendingDoctorTargetId = null;
        room.pendingDoctorSource = null;
        room.nightActions.clear();
        room.wolfChatMessages = [];
        room.girlPeekActive = false;
        room.girlPeekExpiresAt = 0;
        room.girlPeekStartedAt = 0;

        if (!checkWinner(room)) {
          room.phase = "day";
          room.phaseEndsAt = Date.now() + 180_000;
        }
        emitState(roomCode);
        continue;
      }

      if (room.pendingDoctorSource === "vote") {
        if (target && target.alive) {
          target.alive = false;
          room.revealedRoleIds.add(target.id);
          addRoomMessage(room, {
            name: "System",
            text: `${target.name} was voted out by the village. Role: ${target.role}.`,
            time: now(),
            system: true,
          });
          setLastEvent(
            room,
            `${target.name} was voted out`,
            `The Doctor did not save ${target.name}. Role: ${target.role}.`,
            "danger",
          );
          applyLoverLinkDeath(room, target.id);

          room.voteHistory.push({
            phase: room.night,
            votedOut: { id: target.id, name: target.name, role: target.role },
            votes: new Map(room.votes),
          });

          if (target.role === "Hunter" && io.sockets.sockets.has(target.id)) {
            room.pendingDoctorTargetId = null;
            room.pendingDoctorSource = null;
            room.pendingHunterId = target.id;
            room.phaseEndsAt = Date.now() + 30_000;
            room.votes.clear();
            emitState(roomCode);
            continue;
          }
        }

        room.pendingDoctorTargetId = null;
        room.pendingDoctorSource = null;
        room.votes.clear();
        if (!checkWinner(room)) {
          room.phase = "night";
          room.night += 1;
          room.phaseEndsAt = Date.now() + 120_000;
        }
        emitState(roomCode);
        continue;
      }
    }

    if (room.winner || room.phase === "lobby" || Date.now() < room.phaseEndsAt)
      continue;

    if (room.pendingHunterId) {
      room.pendingHunterId = null;
      room.votes.clear();
      addRoomMessage(room, {
        name: "System",
        text: "The Hunter did not take a final shot.",
        time: now(),
        system: true,
      });
      if (!checkWinner(room)) {
        room.phase = "night";
        room.night += 1;
        room.phaseEndsAt = Date.now() + 120_000;
      }
      emitState(roomCode);
      continue;
    }

    if (room.phase === "night") {
      resolveNight(roomCode);
    } else {
      if (room.votes.size > 0) {
        if (room.voteRevealUntil === 0) {
          room.voteRevealUntil = Date.now() + 5_000;
          room.phaseEndsAt = room.voteRevealUntil;
          emitState(roomCode);
        }
        continue;
      }

      const alivePlayers = room.players.filter((player) => player.alive);
      const connectedAlive = alivePlayers.filter((player) =>
        io.sockets.sockets.has(player.id),
      );

      if (
        alivePlayers.length <= 5 &&
        connectedAlive.some((player) => !room.votes.has(player.id))
      ) {
        room.phaseEndsAt = Date.now() + 20_000;
        setLastEvent(
          room,
          "Endgame vote required",
          "All living players must cast a vote before night can begin.",
          "info",
        );
        emitState(roomCode);
        continue;
      }

      room.votes.clear();
      room.phase = "night";
      room.night += 1;
      room.phaseEndsAt = Date.now() + 120_000;
      addRoomMessage(room, {
        name: "System",
        text: "The day ended before everyone could agree. The village falls asleep.",
        time: now(),
        system: true,
      });
      setLastEvent(
        room,
        "Daylight faded",
        "No complete vote was reached. Night begins.",
        "info",
      );
      emitState(roomCode);
    }
  }
}

setInterval(resolveExpiredPhases, 500);
setInterval(cleanupExpiredSessions, 30_000);

io.on("connection", (socket) => {
  socket.on(
    "room:join",
    (payload: string | { name?: string; room?: string }) => {
      const requestedName =
        typeof payload === "string" ? payload : payload?.name;
      const requestedRoom =
        typeof payload === "string" ? DEFAULT_ROOM : payload?.room;
      const roomCode =
        String(requestedRoom ?? DEFAULT_ROOM)
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, "")
          .slice(0, 16) || DEFAULT_ROOM;

      socket.data.room = roomCode;
      socket.join(roomCode);

      const room = getRoom(roomCode);
      const name =
        String(requestedName ?? "Player")
          .trim()
          .slice(0, 18) || "Player";

      const existing = room.players.find((player) => player.id === socket.id);
      if (existing) {
        existing.name = name;
      } else {
        if (room.roomLocked) {
          socket.emit("game:error", "This room is locked.");
          return;
        }
        const joiningMidMatch = room.phase !== "lobby";
        const sessionToken = createSessionToken(socket.id, roomCode, name);
        room.players.push({
          id: socket.id,
          name,
          role: "Villager",
          alive: !joiningMidMatch,
          sessionToken,
        });
        room.inspections.set(socket.id, new Map());
        room.readyPlayers.delete(socket.id);
        if (!room.hostId) room.hostId = socket.id;
        addRoomMessage(room, {
          name: "System",
          text: joiningMidMatch
            ? `${name} joined mid-match and is spectating until next round.`
            : `${name} joined the village.`,
          time: now(),
          system: true,
        });
      }

      emitState(roomCode);
    },
  );

  socket.on(
    "room:rejoin",
    (payload: { token?: string; name?: string; room?: string }) => {
      const token = String(payload?.token ?? "");
      const session = sessionStore.get(token);
      if (!session || Date.now() >= session.expiresAt) {
        socket.emit("game:error", "Session expired or invalid.");
        return;
      }

      const roomCode = session.roomCode;
      socket.data.room = roomCode;
      socket.join(roomCode);

      const room = getRoom(roomCode);
      const oldId = session.playerId;
      const player = room.players.find((p) => p.id === oldId);

      if (player) {
        const duplicateIndex = room.players.findIndex(
          (p) => p.id === socket.id && p.id !== oldId,
        );
        if (duplicateIndex >= 0) {
          room.players.splice(duplicateIndex, 1);
        }

        player.id = socket.id;
        player.sessionToken = token;
        session.playerId = socket.id;

        if (room.hostId === oldId) room.hostId = socket.id;
        if (room.pendingHunterId === oldId) room.pendingHunterId = socket.id;
        if (room.pendingDoctorTargetId === oldId) {
          room.pendingDoctorTargetId = socket.id;
        }
        if (room.girlOfTheNightId === oldId) {
          room.girlOfTheNightId = socket.id;
        }

        const oldInspection = room.inspections.get(oldId);
        if (oldInspection) {
          room.inspections.delete(oldId);
          room.inspections.set(socket.id, oldInspection);
        }

        if (room.readyPlayers.delete(oldId)) room.readyPlayers.add(socket.id);
        if (room.doctorUsedIds.delete(oldId)) room.doctorUsedIds.add(socket.id);
        if (room.cupidUsedIds.delete(oldId)) room.cupidUsedIds.add(socket.id);
        if (room.revealedRoleIds.delete(oldId))
          room.revealedRoleIds.add(socket.id);

        const migratedVotes = new Map<string, string>();
        for (const [voterId, targetId] of room.votes.entries()) {
          migratedVotes.set(
            voterId === oldId ? socket.id : voterId,
            targetId === oldId ? socket.id : targetId,
          );
        }
        room.votes = migratedVotes;

        const migratedNightActions = new Map<string, string>();
        for (const [actorId, targetId] of room.nightActions.entries()) {
          migratedNightActions.set(
            actorId === oldId ? socket.id : actorId,
            targetId === oldId ? socket.id : targetId,
          );
        }
        room.nightActions = migratedNightActions;

        room.lovers = room.lovers.map((id) => (id === oldId ? socket.id : id));

        addRoomMessage(room, {
          name: "System",
          text: `${player.name} has returned.`,
          time: now(),
          system: true,
        });
      } else {
        socket.emit(
          "game:error",
          "Could not restore player session in this room.",
        );
        return;
      }

      emitState(roomCode);
    },
  );

  socket.on("player:rename", (name: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const player = room.players.find((candidate) => candidate.id === socket.id);
    if (!player || (room.phase !== "lobby" && !room.winner)) return;

    const cleanName = String(name ?? "").trim().slice(0, 18);
    if (!cleanName || cleanName === player.name) return;

    const oldName = player.name;
    player.name = cleanName;
    addRoomMessage(room, {
      name: "System",
      text: `${oldName} is now known as ${cleanName}.`,
      time: now(),
      system: true,
    });
    emitState(roomCode);
  });

  socket.on("chat:send", (text: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const player = room.players.find((candidate) => candidate.id === socket.id);
    const clean = String(text ?? "")
      .trim()
      .slice(0, 240);
    if (!player || !clean || !player.alive) return;

    addRoomMessage(room, { name: player.name, text: clean, time: now() });
    socket.to(roomCode).emit("chat:received");
    emitState(roomCode);
  });

  socket.on("wolf:chat:send", (text: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const player = room.players.find((candidate) => candidate.id === socket.id);
    const clean = String(text ?? "")
      .trim()
      .slice(0, 240);
    if (!player || !clean || !player.alive || room.phase !== "night") return;

    if (
      player.role !== "Werewolf" &&
      !(player.role === "GirlOfTheNight" && room.girlPeekActive)
    )
      return;

    addWolfMessage(room, {
      name: player.name,
      text: clean,
      time: now(),
      wolf: player.role === "Werewolf",
    });
    emitState(roomCode);
  });

  socket.on("room:ready", (isReady: boolean) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const player = room.players.find((candidate) => candidate.id === socket.id);
    if (!player || room.phase !== "lobby") return;

    if (isReady) room.readyPlayers.add(socket.id);
    else room.readyPlayers.delete(socket.id);

    emitState(roomCode);
  });

  socket.on("game:start", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId || room.phase !== "lobby") return;

    const humans = room.players.filter((player) => !player.id.endsWith("-bot"));
    if (
      humans.length < 2 ||
      humans.some((player) => !room.readyPlayers.has(player.id))
    )
      return;

    assignRoles(room);
    room.winner = null;
    room.pendingHunterId = null;
    room.pendingDoctorTargetId = null;
    room.pendingDoctorSource = null;
    room.votes.clear();
    room.voteRevealUntil = 0;
    room.nightActions.clear();
    room.readyPlayers.clear();
    room.wolfChatMessages = [];
    room.girlPeekActive = false;
    room.girlPeekExpiresAt = 0;
    room.girlPeekStartedAt = 0;
    room.girlOfTheNightId = null;
    room.lovers = [];
    room.doctorUsedIds.clear();
    room.cupidUsedIds.clear();
    room.maidUsed = false;
    room.revealedRoleIds.clear();

    room.phase = "night";
    room.night = 1;
    room.phaseEndsAt = Date.now() + 120_000;

    addRoomMessage(room, {
      name: "System",
      text: "The village falls asleep. The game begins.",
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      "The game begins",
      "The village has gone quiet. Choose your action.",
      "info",
    );
    emitState(roomCode);
  });

  socket.on("game:reset", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId) return;

    room.players.forEach((player) => {
      player.alive = true;
      player.role = "Villager";
    });

    room.phase = "lobby";
    room.night = 0;
    room.phaseEndsAt = 0;
    room.winner = null;
    room.pendingHunterId = null;
    room.pendingDoctorTargetId = null;
    room.pendingDoctorSource = null;
    room.votes.clear();
    room.voteRevealUntil = 0;
    room.nightActions.clear();
    room.pendingDoctorTargetId = null;
    room.pendingDoctorSource = null;
    room.wolfChatMessages = [];
    room.girlPeekActive = false;
    room.girlPeekExpiresAt = 0;
    room.girlPeekStartedAt = 0;
    room.girlOfTheNightId = null;
    room.lovers = [];
    room.doctorUsedIds.clear();
    room.cupidUsedIds.clear();
    room.maidUsed = false;
    room.revealedRoleIds.clear();
    room.readyPlayers.clear();
    room.messages = [
      {
        name: "System",
        text: "A new round is ready. Everyone is back in the lobby.",
        time: now(),
        system: true,
      },
    ];
    setLastEvent(
      room,
      "A new round is ready",
      "The village has been reset for a fresh match.",
      "success",
    );
    room.nightHistory = [];
    room.voteHistory = [];

    emitState(roomCode);
  });

  socket.on("host:kick", (targetId: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId) return;

    const index = room.players.findIndex((p) => p.id === targetId);
    if (index >= 0) {
      const kicked = room.players.splice(index, 1)[0];
      addRoomMessage(room, {
        name: "System",
        text: `${kicked.name} was removed by the host.`,
        time: now(),
        system: true,
      });
      room.inspections.delete(targetId);
      room.readyPlayers.delete(targetId);
      room.votes.delete(targetId);
      room.nightActions.delete(targetId);
      room.doctorUsedIds.delete(targetId);
      room.cupidUsedIds.delete(targetId);
      room.revealedRoleIds.delete(targetId);
      if (room.pendingDoctorTargetId === targetId) {
        room.pendingDoctorTargetId = null;
        room.pendingDoctorSource = null;
      }
      for (const [voterId, votedId] of [...room.votes.entries()]) {
        if (votedId === targetId) room.votes.delete(voterId);
      }
      for (const [actorId, actionTarget] of [...room.nightActions.entries()]) {
        if (actionTarget === targetId) room.nightActions.delete(actorId);
      }
      emitState(roomCode);
    }
  });

  socket.on("host:lock-room", (locked: boolean) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId) return;
    room.roomLocked = locked;
    addRoomMessage(room, {
      name: "System",
      text: locked ? "The room is now locked." : "The room is now open.",
      time: now(),
      system: true,
    });
    emitState(roomCode);
  });

  socket.on("host:force-start", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId || room.phase !== "lobby") return;

    const humans = room.players.filter((player) => !player.id.endsWith("-bot"));
    if (humans.length < 2) return;

    assignRoles(room);
    room.winner = null;
    room.pendingHunterId = null;
    room.pendingDoctorTargetId = null;
    room.pendingDoctorSource = null;
    room.votes.clear();
    room.voteRevealUntil = 0;
    room.nightActions.clear();
    room.readyPlayers.clear();
    room.wolfChatMessages = [];
    room.girlPeekActive = false;
    room.girlPeekExpiresAt = 0;
    room.girlPeekStartedAt = 0;
    room.girlOfTheNightId = null;
    room.lovers = [];
    room.doctorUsedIds.clear();
    room.cupidUsedIds.clear();
    room.maidUsed = false;
    room.revealedRoleIds.clear();

    room.phase = "night";
    room.night = 1;
    room.phaseEndsAt = Date.now() + 120_000;

    addRoomMessage(room, {
      name: "System",
      text: "The game has started by force.",
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      "The game begins",
      "The village has gone quiet. Choose your action.",
      "info",
    );
    emitState(roomCode);
  });

  socket.on("host:end-match", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId) return;

    room.winner = "village";
    addRoomMessage(room, {
      name: "System",
      text: "The match was ended by the host.",
      time: now(),
      system: true,
    });
    setLastEvent(room, "Match ended", "The host ended this match.", "info");
    emitState(roomCode);
  });

  socket.on("room:set-preset", (preset: RolePreset) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId || room.phase !== "lobby") return;
    if (!["classic", "chaos", "beginner"].includes(preset)) return;
    room.rolePreset = preset;
    addRoomMessage(room, {
      name: "System",
      text: `Role preset changed to ${preset}.`,
      time: now(),
      system: true,
    });
    emitState(roomCode);
  });

  socket.on("room:toggle-tutorial", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId) return;
    room.tutorialEnabled = !room.tutorialEnabled;
    emitState(roomCode);
  });

  socket.on("phase:toggle", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.hostId || room.winner || room.phase === "lobby")
      return;

    room.phase = room.phase === "night" ? "day" : "night";
    room.phaseEndsAt =
      Date.now() + (room.phase === "night" ? 120_000 : 180_000);
    if (room.phase === "night") room.night += 1;

    room.votes.clear();
    room.voteRevealUntil = 0;
    room.nightActions.clear();
    room.wolfChatMessages = [];
    room.girlPeekActive = false;
    room.girlPeekExpiresAt = 0;
    room.girlPeekStartedAt = 0;

    addRoomMessage(room, {
      name: "System",
      text:
        room.phase === "night"
          ? "The village falls asleep."
          : "The village wakes.",
      time: now(),
      system: true,
    });

    setLastEvent(
      room,
      room.phase === "night" ? "Night has fallen" : "The village is awake",
      room.phase === "night"
        ? "Werewolves and special roles: choose your action."
        : "Discuss and decide who to trust.",
      "info",
    );

    emitState(roomCode);
  });

  socket.on("night:action", (targetId: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);

    const actor = room.players.find((player) => player.id === socket.id);
    const target = room.players.find((player) => player.id === targetId);
    if (
      !actor ||
      !target ||
      room.phase !== "night" ||
      !actor.alive ||
      !target.alive ||
      actor.id === target.id ||
      room.winner
    )
      return;

    if (actor.role === "Werewolf") {
      room.nightActions.set(actor.id, target.id);
      socket.emit("game:action-confirmed", {
        title: "Victim selected",
        detail: `${target.name} is your current target. You can still change it before night ends.`,
      });

      const requiredActors = room.players.filter(
        (player) => player.alive && player.role === "Werewolf",
      );
      if (requiredActors.every((player) => room.nightActions.has(player.id))) {
        resolveNight(roomCode);
      } else {
        emitState(roomCode);
      }
      return;
    }

    if (actor.role === "Maid") {
      if (room.maidUsed) {
        socket.emit("game:error", "The Maid can only swap once per match.");
        return;
      }
      const originalRole = actor.role;
      actor.role = target.role;
      target.role = originalRole;
      room.maidUsed = true;
      room.nightActions.set(actor.id, target.id);
      addRoomMessage(room, {
        name: "System",
        text: `${actor.name} exchanged roles in the dark.`,
        time: now(),
        system: true,
      });
      setLastEvent(
        room,
        "The Maid changed fate",
        `${actor.name} swapped roles with ${target.name}.`,
        "info",
      );
      emitState(roomCode);
      return;
    }
  });

  socket.on("dog:choose", (alignment: "villager" | "werewolf") => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const dog = room.players.find((player) => player.id === socket.id);
    if (!dog || dog.role !== "Dog" || !dog.alive || room.phase !== "night")
      return;

    dog.role = alignment === "werewolf" ? "Werewolf" : "Villager";
    room.nightActions.set(dog.id, alignment);
    addRoomMessage(room, {
      name: "System",
      text: "A silent choice of allegiance was made in the dark.",
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      "The Dog chose a path",
      "A hidden player shifted allegiance.",
      "info",
    );
    emitState(roomCode);
  });

  socket.on("girl:peek:start", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const girl = room.players.find((player) => player.id === socket.id);

    if (
      !girl ||
      girl.role !== "GirlOfTheNight" ||
      !girl.alive ||
      room.phase !== "night" ||
      room.girlPeekActive ||
      room.winner
    )
      return;

    room.girlPeekActive = true;
    room.girlPeekStartedAt = Date.now();
    room.girlPeekExpiresAt = 0;
    room.girlOfTheNightId = girl.id;
    emitState(roomCode);
  });

  socket.on("girl:peek:stop", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const girl = room.players.find((player) => player.id === socket.id);
    if (
      !girl ||
      girl.role !== "GirlOfTheNight" ||
      room.phase !== "night" ||
      room.winner
    )
      return;

    room.girlPeekActive = false;
    room.girlPeekExpiresAt = 0;
    room.girlPeekStartedAt = 0;
    room.girlOfTheNightId = null;
    emitState(roomCode);
  });

  socket.on("cupid:bind", (targetIds: string[]) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const cupid = room.players.find((player) => player.id === socket.id);
    if (
      !cupid ||
      cupid.role !== "Cupid" ||
      !cupid.alive ||
      room.phase !== "night"
    )
      return;

    if (room.cupidUsedIds.has(cupid.id)) {
      socket.emit("game:error", "Cupid can only bind lovers once per match.");
      return;
    }

    const ids = Array.isArray(targetIds) ? targetIds : [];
    const first = room.players.find((player) => player.id === ids[0]);
    const second = room.players.find((player) => player.id === ids[1]);
    if (
      !first ||
      !second ||
      !first.alive ||
      !second.alive ||
      first.id === second.id ||
      first.id === cupid.id ||
      second.id === cupid.id
    )
      return;

    room.lovers = [first.id, second.id];
    room.cupidUsedIds.add(cupid.id);
    room.nightActions.set(cupid.id, `${first.id}|${second.id}`);
    addRoomMessage(room, {
      name: "System",
      text: "Two hearts are now bound by fate.",
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      "Cupid struck",
      `${first.name} and ${second.name} are linked.`,
      "success",
    );
    emitState(roomCode);
  });

  socket.on("hunter:shoot", (targetId: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    if (socket.id !== room.pendingHunterId || room.winner) return;

    const target = room.players.find((player) => player.id === targetId);
    if (!target || !target.alive || target.id === socket.id) return;

    target.alive = false;
    room.revealedRoleIds.add(target.id);
    room.pendingHunterId = null;
    addRoomMessage(room, {
      name: "System",
      text: `The Hunter took one final shot at ${target.name}. Role: ${target.role}.`,
      time: now(),
      system: true,
    });
    setLastEvent(
      room,
      "The Hunter fired",
      `${target.name} fell to the final shot. Role: ${target.role}.`,
      "danger",
    );
    applyLoverLinkDeath(room, target.id);

    if (!checkWinner(room)) {
      room.phase = "night";
      room.night += 1;
      room.phaseEndsAt = Date.now() + 120_000;
    }

    emitState(roomCode);
  });

  socket.on("vote:submit", (targetId: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const voter = room.players.find((player) => player.id === socket.id);
    const target = room.players.find((player) => player.id === targetId);

    if (
      !voter ||
      !target ||
      room.phase !== "day" ||
      !voter.alive ||
      !target.alive ||
      voter.id === target.id ||
      room.winner ||
      room.voteRevealUntil > 0
    )
      return;

    for (const [voterId, votedId] of [...room.votes.entries()]) {
      const voterAlive = room.players.find((player) => player.id === voterId)?.alive;
      const targetAlive = room.players.find((player) => player.id === votedId)?.alive;
      if (!voterAlive || !targetAlive) room.votes.delete(voterId);
    }

    room.votes.set(voter.id, target.id);
    socket.emit("game:action-confirmed", {
      title: "Vote recorded",
      detail: `Your vote for ${target.name} is locked in.`,
    });

    const connectedAlive = room.players.filter(
      (player) => player.alive && io.sockets.sockets.has(player.id),
    );
    if (
      connectedAlive.length === 0 ||
      connectedAlive.every((player) => room.votes.has(player.id))
    ) {
      room.voteRevealUntil = Date.now() + 5_000;
      room.phaseEndsAt = room.voteRevealUntil;
      emitState(roomCode);
      return;
    }

    emitState(roomCode);
  });

  socket.on("seer:inspect", (targetId: string) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const seer = room.players.find((player) => player.id === socket.id);
    const target = room.players.find((player) => player.id === targetId);
    if (
      !seer ||
      seer.role !== "Seer" ||
      room.phase !== "night" ||
      !target ||
      !target.alive ||
      target.id === seer.id
    )
      return;

    if (room.nightActions.get(seer.id) === `seer:${room.night}`) {
      socket.emit("game:error", "The Seer can inspect only once per night.");
      return;
    }

    const seen = room.inspections.get(seer.id) ?? new Map<string, Role>();
    seen.set(target.id, target.role);
    room.inspections.set(seer.id, seen);
    room.nightActions.set(seer.id, `seer:${room.night}`);

    socket.emit("game:action-confirmed", {
      title: "Vision received",
      detail: `${target.name} has been revealed to you.`,
    });
    emitState(roomCode);
  });

  socket.on("doctor:decide", (save: boolean) => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);
    const doctor = room.players.find((player) => player.id === socket.id);
    if (
      !doctor ||
      doctor.role !== "Doctor" ||
      !doctor.alive ||
      !room.pendingDoctorTargetId ||
      room.doctorUsedIds.has(doctor.id)
    )
      return;

    const target = room.players.find(
      (player) => player.id === room.pendingDoctorTargetId,
    );

    if (save && target && target.alive) {
      room.doctorUsedIds.add(doctor.id);
      room.revealedRoleIds.add(doctor.id);
      room.revealedRoleIds.add(target.id);
      addRoomMessage(room, {
        name: "System",
        text: `Doctor ${doctor.name} saved ${target.name}. Roles revealed: Doctor and ${target.role}.`,
        time: now(),
        system: true,
      });
      setLastEvent(
        room,
        "Doctor save",
        `${doctor.name} saved ${target.name}. Roles revealed: Doctor and ${target.role}.`,
        "success",
      );
    }

    if (room.pendingDoctorSource === "night") {
      const wolfVotes = collectWolfVotes(room);

      if (!save && target && target.alive) {
        target.alive = false;
        room.revealedRoleIds.add(target.id);
        addRoomMessage(room, {
          name: "System",
          text: `${target.name} did not survive the night. Role: ${target.role}.`,
          time: now(),
          system: true,
        });
        setLastEvent(
          room,
          `${target.name} died during the night`,
          `The Doctor did not save ${target.name}. Role: ${target.role}.`,
          "danger",
        );
        applyLoverLinkDeath(room, target.id);
      }

      room.nightHistory.push({
        night: room.night,
        victim: !save && target ? { id: target.id, name: target.name, role: target.role } : null,
        protected: save && target ? { id: target.id, name: target.name } : null,
        wolfVotes,
      });

      if (!save && target?.role === "Hunter" && io.sockets.sockets.has(target.id)) {
        room.pendingDoctorTargetId = null;
        room.pendingDoctorSource = null;
        room.pendingHunterId = target.id;
        room.phaseEndsAt = Date.now() + 30_000;
        emitState(roomCode);
        return;
      }

      room.pendingDoctorTargetId = null;
      room.pendingDoctorSource = null;
      room.nightActions.clear();
      room.wolfChatMessages = [];
      room.girlPeekActive = false;
      room.girlPeekExpiresAt = 0;
      room.girlPeekStartedAt = 0;
      room.girlOfTheNightId = null;

      if (!checkWinner(room)) {
        room.phase = "day";
        room.phaseEndsAt = Date.now() + 180_000;
      }

      emitState(roomCode);
      return;
    }

    if (room.pendingDoctorSource === "vote") {
      if (!save && target && target.alive) {
        target.alive = false;
        room.revealedRoleIds.add(target.id);
        addRoomMessage(room, {
          name: "System",
          text: `${target.name} was voted out by the village. Role: ${target.role}.`,
          time: now(),
          system: true,
        });
        setLastEvent(
          room,
          `${target.name} was voted out`,
          `The Doctor did not save ${target.name}. Role: ${target.role}.`,
          "danger",
        );
        applyLoverLinkDeath(room, target.id);

        room.voteHistory.push({
          phase: room.night,
          votedOut: { id: target.id, name: target.name, role: target.role },
          votes: new Map(room.votes),
        });

        if (target.role === "Hunter" && io.sockets.sockets.has(target.id)) {
          room.pendingDoctorTargetId = null;
          room.pendingDoctorSource = null;
          room.pendingHunterId = target.id;
          room.phaseEndsAt = Date.now() + 30_000;
          room.votes.clear();
          emitState(roomCode);
          return;
        }
      }

      room.pendingDoctorTargetId = null;
      room.pendingDoctorSource = null;
      room.votes.clear();
      if (!checkWinner(room)) {
        room.phase = "night";
        room.night += 1;
        room.phaseEndsAt = Date.now() + 120_000;
      }
      emitState(roomCode);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.room ?? DEFAULT_ROOM;
    const room = getRoom(roomCode);

    const index = room.players.findIndex((player) => player.id === socket.id);
    if (index >= 0) {
      const [leaver] = room.players.splice(index, 1);
      addRoomMessage(room, {
        name: "System",
        text: `${leaver.name} left the village.`,
        time: now(),
        system: true,
      });
    }

    room.inspections.delete(socket.id);
    room.readyPlayers.delete(socket.id);
    room.votes.delete(socket.id);
    room.nightActions.delete(socket.id);
    room.doctorUsedIds.delete(socket.id);
    room.cupidUsedIds.delete(socket.id);
    room.revealedRoleIds.delete(socket.id);

    for (const [voterId, votedId] of [...room.votes.entries()]) {
      if (votedId === socket.id) room.votes.delete(voterId);
    }
    for (const [actorId, actionTarget] of [...room.nightActions.entries()]) {
      if (actionTarget === socket.id) room.nightActions.delete(actorId);
    }

    if (room.pendingHunterId === socket.id) room.pendingHunterId = null;
    if (room.pendingDoctorTargetId === socket.id) {
      room.pendingDoctorTargetId = null;
      room.pendingDoctorSource = null;
    }
    if (room.girlOfTheNightId === socket.id) {
      room.girlOfTheNightId = null;
      room.girlPeekActive = false;
      room.girlPeekExpiresAt = 0;
      room.girlPeekStartedAt = 0;
    }

    if (room.hostId === socket.id) {
      const connectedInRoom = Array.from(io.sockets.sockets.values()).filter(
        (candidate) =>
          candidate.data.room === roomCode && candidate.id !== socket.id,
      );
      room.hostId = connectedInRoom[0]?.id ?? room.players[0]?.id ?? "";
    }

    emitState(roomCode);
  });
});

httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`Millers Hollow server listening on port ${PORT}`),
);
