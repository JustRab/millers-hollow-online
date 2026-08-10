import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Server } from 'socket.io'

const PORT = Number(process.env.PORT ?? 3001)
const DIST_DIR = join(process.cwd(), 'dist')
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}
const ROOM = 'MILL-7Q2'
type Phase = 'lobby' | 'night' | 'day'
type Role = 'Seer' | 'Werewolf' | 'Villager' | 'Doctor' | 'Hunter'
type Player = { id: string; name: string; role: Role; alive: boolean }
type Message = { name: string; text: string; time: string; system?: boolean }
type GameEvent = { id: number; title: string; detail: string; tone: 'info' | 'danger' | 'success' }

const players: Player[] = [
  { id: 'mara-bot', name: 'Mara V.', role: 'Werewolf', alive: true },
  { id: 'jon-bot', name: 'Jon Bell', role: 'Villager', alive: true },
  { id: 'sofia-bot', name: 'Sofia K.', role: 'Doctor', alive: true },
  { id: 'theo-bot', name: 'Theo R.', role: 'Hunter', alive: true },
  { id: 'nina-bot', name: 'Nina L.', role: 'Villager', alive: false },
  { id: 'owen-bot', name: 'Owen P.', role: 'Villager', alive: true },
  { id: 'elio-bot', name: 'Elio M.', role: 'Werewolf', alive: true },
]
let phase: Phase = 'lobby'
let night = 2
let hostId = ''
let winner: 'village' | 'werewolves' | null = null
let phaseEndsAt = 0
let pendingHunterId: string | null = null
let eventId = 0
let lastEvent: GameEvent | null = null
const messages: Message[] = [
  { name: 'System', text: 'A hush settles over Millers Hollow.', time: '10:42 PM', system: true },
]
const inspections = new Map<string, Map<string, Role>>()
const votes = new Map<string, string>()
const nightActions = new Map<string, string>()
const readyPlayers = new Set<string>()

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, service: 'millers-hollow' }))
    return
  }
  if (request.method !== 'GET' || !existsSync(join(DIST_DIR, 'index.html'))) {
    response.writeHead(404)
    response.end('Not found')
    return
  }
  const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
  const candidate = join(DIST_DIR, relativePath)
  const filePath = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(DIST_DIR, 'index.html')
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  response.writeHead(200, { 'content-type': contentTypes[extension] ?? 'application/octet-stream' })
  response.end(readFileSync(filePath))
})
const io = new Server(httpServer, { cors: { origin: process.env.CORS_ORIGIN ?? true } })
const now = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const publicPlayers = () => players.map(({ id, name, alive }) => ({ id, name, alive }))
const announce = (title: string, detail: string, tone: GameEvent['tone']) => { lastEvent = { id: ++eventId, title, detail, tone } }

function emitState() {
  for (const socket of io.sockets.sockets.values()) {
    const mine = players.find((player) => player.id === socket.id)
    socket.emit('game:state', {
      room: ROOM,
      phase,
      phaseEndsAt,
      pendingHunterId,
      readyIds: [...readyPlayers],
      night,
      hostId,
      winner,
      lastEvent,
      players: publicPlayers(),
      me: mine ? { id: mine.id, name: mine.name, role: mine.role, alive: mine.alive } : null,
      inspections: Object.fromEntries(inspections.get(socket.id) ?? []),
      myVote: votes.get(socket.id) ?? null,
      voteCounts: Object.fromEntries([...votes.values()].map((targetId) => [targetId, [...votes.values()].filter((value) => value === targetId).length])),
      myNightAction: nightActions.get(socket.id) ?? null,
      messages,
    })
  }
}

function resolveExpiredPhase() {
  if (winner || phase === 'lobby' || Date.now() < phaseEndsAt) return
  if (pendingHunterId) {
    pendingHunterId = null
    messages.push({ name: 'System', text: 'The Hunter did not take a final shot.', time: now(), system: true })
    if (phase === 'day') { phase = 'night'; night += 1; phaseEndsAt = Date.now() + 120_000 }
    else { phase = 'day'; phaseEndsAt = Date.now() + 180_000 }
    announce('The Hunter has fallen silent', 'The village continues without a final shot.', 'info')
    emitState()
    return
  }
  if (phase === 'night') {
    const wolf = players.find((player) => player.alive && player.role === 'Werewolf' && io.sockets.sockets.has(player.id))
    const doctor = players.find((player) => player.alive && player.role === 'Doctor' && io.sockets.sockets.has(player.id))
    const victimId = wolf ? nightActions.get(wolf.id) : undefined
    const protectedId = doctor ? nightActions.get(doctor.id) : undefined
    if (victimId && victimId !== protectedId) {
      const victim = players.find((player) => player.id === victimId)
      if (victim) { victim.alive = false; messages.push({ name: 'System', text: `${victim.name} did not survive the night.`, time: now(), system: true }); announce(`${victim.name} died during the night`, 'The village wakes to a missing voice.', 'danger'); if (victim.role === 'Hunter' && io.sockets.sockets.has(victim.id)) { pendingHunterId = victim.id; phaseEndsAt = Date.now() + 30_000; emitState(); return } }
    } else { messages.push({ name: 'System', text: 'The village wakes. Nobody was lost in the night.', time: now(), system: true }); announce('Nobody was lost', 'The night ended without a casualty.', 'success') }
    nightActions.clear()
    const wolves = players.filter((player) => player.alive && player.role === 'Werewolf').length
    const villagers = players.filter((player) => player.alive && player.role !== 'Werewolf').length
    if (wolves === 0) { winner = 'village'; announce('The village wins', 'Every werewolf has been eliminated.', 'success') }
    else if (wolves >= villagers) { winner = 'werewolves'; announce('The werewolves win', 'The wolves now control the village.', 'danger') }
    else { phase = 'day'; phaseEndsAt = Date.now() + 180_000 }
  } else {
    votes.clear()
    phase = 'night'
    night += 1
    phaseEndsAt = Date.now() + 120_000
    messages.push({ name: 'System', text: 'The day ended before everyone could agree. The village falls asleep.', time: now(), system: true })
    announce('Daylight faded', 'No complete vote was reached. Night begins.', 'info')
  }
  emitState()
}

setInterval(resolveExpiredPhase, 500)

io.on('connection', (socket) => {
  socket.on('room:join', (requestedName: string) => {
    const name = String(requestedName || 'Player').trim().slice(0, 18) || 'Player'
    const existingPlayer = players.find((player) => player.id === socket.id)
    if (existingPlayer) {
      existingPlayer.name = name
      socket.join(ROOM)
      emitState()
      return
    }
    if (!hostId) hostId = socket.id
    const connectedHumans = players.filter((player) => !player.id.endsWith('-bot')).length
    const role: Role = (['Seer', 'Werewolf', 'Doctor'] as Role[])[connectedHumans] ?? 'Villager'
    players.push({ id: socket.id, name, role, alive: true })
    inspections.set(socket.id, new Map())
    socket.join(ROOM)
    messages.push({ name: 'System', text: `${name} joined the village.`, time: now(), system: true })
    emitState()
  })

  socket.on('chat:send', (text: string) => {
    const player = players.find((candidate) => candidate.id === socket.id)
    const clean = String(text ?? '').trim().slice(0, 240)
    if (!player || !clean || !player.alive) return
    messages.push({ name: player.name, text: clean, time: now() })
    socket.broadcast.emit('chat:received')
    emitState()
  })

  socket.on('phase:toggle', () => {
    if (socket.id !== hostId || winner || phase === 'lobby') return
    phase = phase === 'night' ? 'day' : 'night'
    phaseEndsAt = Date.now() + (phase === 'night' ? 120_000 : 180_000)
    if (phase === 'night') night += 1
    votes.clear()
    nightActions.clear()
    messages.push({ name: 'System', text: phase === 'night' ? 'The village falls asleep.' : 'The village wakes.', time: now(), system: true })
    announce(phase === 'night' ? 'Night has fallen' : 'The village is awake', phase === 'night' ? 'Werewolves, Doctor, and Seer: choose your action.' : 'Discuss what happened and decide who to trust.', 'info')
    emitState()
  })

  socket.on('game:start', () => {
    if (socket.id !== hostId || phase !== 'lobby') return
    phase = 'night'
    night = 1
    phaseEndsAt = Date.now() + 120_000
    messages.push({ name: 'System', text: 'The village falls asleep. The game begins.', time: now(), system: true })
    announce('The game begins', 'The village has gone quiet. Choose your action.', 'info')
    emitState()
  })

  socket.on('game:reset', () => {
    if (socket.id !== hostId) return
    const humanPlayers = players.filter((player) => !player.id.endsWith('-bot'))
    const humanRoles: Role[] = ['Seer', 'Werewolf', 'Doctor']
    for (const player of players) {
      if (player.id.endsWith('-bot')) player.alive = player.id !== 'nina-bot'
    }
    humanPlayers.forEach((player, index) => { player.alive = true; player.role = humanRoles[index] ?? 'Villager' })
    phase = 'night'
    night = 1
    winner = null
    phaseEndsAt = Date.now() + 120_000
    pendingHunterId = null
    votes.clear()
    nightActions.clear()
    inspections.clear()
    for (const player of humanPlayers) inspections.set(player.id, new Map())
    messages.length = 0
    messages.push({ name: 'System', text: 'A new game begins. The village falls asleep.', time: now(), system: true })
    announce('A new game begins', 'The village has been reset for a fresh round.', 'success')
    emitState()
  })

  socket.on('night:action', (targetId: string) => {
    const actor = players.find((player) => player.id === socket.id)
    const target = players.find((player) => player.id === targetId)
    if (winner || phase !== 'night' || !actor?.alive || !target?.alive || target.id === actor.id || !['Werewolf', 'Doctor'].includes(actor.role)) return
    nightActions.set(socket.id, target.id)
    socket.emit('game:action-confirmed', { title: actor.role === 'Werewolf' ? 'Victim selected' : 'Protection selected', detail: `${target.name} is locked in for this night.` })
    const connectedSpecialRoles = players.filter((player) => player.alive && io.sockets.sockets.has(player.id) && ['Werewolf', 'Doctor'].includes(player.role))
    if (connectedSpecialRoles.every((player) => nightActions.has(player.id))) {
      const wolf = connectedSpecialRoles.find((player) => player.role === 'Werewolf')
      const doctor = connectedSpecialRoles.find((player) => player.role === 'Doctor')
      const victimId = wolf ? nightActions.get(wolf.id) : undefined
      const protectedId = doctor ? nightActions.get(doctor.id) : undefined
      if (victimId && victimId !== protectedId) {
        const victim = players.find((player) => player.id === victimId)
        if (victim) {
          victim.alive = false
          messages.push({ name: 'System', text: `${victim.name} did not survive the night.`, time: now(), system: true })
          announce(`${victim.name} died during the night`, 'The village wakes to a missing voice.', 'danger')
          if (victim.role === 'Hunter' && io.sockets.sockets.has(victim.id)) { pendingHunterId = victim.id; emitState(); return }
        }
      } else { messages.push({ name: 'System', text: 'The village wakes. Nobody was lost in the night.', time: now(), system: true }); announce('Nobody was lost', 'The Doctor protected the target.', 'success') }
      const wolves = players.filter((player) => player.alive && player.role === 'Werewolf').length
      const villagers = players.filter((player) => player.alive && player.role !== 'Werewolf').length
      if (wolves === 0) { winner = 'village'; announce('The village wins', 'Every werewolf has been eliminated.', 'success') }
      else if (wolves >= villagers) { winner = 'werewolves'; announce('The werewolves win', 'The wolves now control the village.', 'danger') }
      if (!winner) { phase = 'day'; phaseEndsAt = Date.now() + 180_000 }
      nightActions.clear()
    }
    emitState()
  })

  socket.on('hunter:shoot', (targetId: string) => {
    if (socket.id !== pendingHunterId || winner) return
    const target = players.find((player) => player.id === targetId)
    if (!target?.alive || target.id === socket.id) return
    target.alive = false
    pendingHunterId = null
    messages.push({ name: 'System', text: `The Hunter took one final shot at ${target.name}.`, time: now(), system: true })
    announce('The Hunter fired', `${target.name} was taken down in the final moment.`, 'danger')
    const wolves = players.filter((player) => player.alive && player.role === 'Werewolf').length
    const villagers = players.filter((player) => player.alive && player.role !== 'Werewolf').length
    if (wolves === 0) { winner = 'village'; announce('The village wins', 'Every werewolf has been eliminated.', 'success') }
    else if (wolves >= villagers) { winner = 'werewolves'; announce('The werewolves win', 'The wolves now control the village.', 'danger') }
    else { phase = 'night'; night += 1; phaseEndsAt = Date.now() + 120_000 }
    emitState()
  })

  socket.on('vote:submit', (targetId: string) => {
    const voter = players.find((player) => player.id === socket.id)
    const target = players.find((player) => player.id === targetId)
    if (winner || phase !== 'day' || !voter?.alive || !target?.alive || target.id === voter.id) return
    votes.set(socket.id, target.id)
    socket.emit('game:action-confirmed', { title: 'Vote recorded', detail: `Your vote for ${target.name} is locked in.` })
    const connectedAlive = players.filter((player) => player.alive && io.sockets.sockets.has(player.id))
    if (connectedAlive.every((player) => votes.has(player.id))) {
      const totals = new Map<string, number>()
      for (const votedId of votes.values()) totals.set(votedId, (totals.get(votedId) ?? 0) + 1)
      const [eliminatedId, highest] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
      const tied = [...totals.values()].filter((count) => count === highest).length > 1
      if (!tied && eliminatedId) {
        const eliminated = players.find((player) => player.id === eliminatedId)
        if (eliminated) {
          eliminated.alive = false
          messages.push({ name: 'System', text: `${eliminated.name} was voted out. They were a ${eliminated.role}.`, time: now(), system: true })
          announce(`${eliminated.name} was voted out`, `They were a ${eliminated.role}.`, 'danger')
          if (eliminated.role === 'Hunter' && io.sockets.sockets.has(eliminated.id)) { pendingHunterId = eliminated.id; emitState(); return }
        }
      } else { messages.push({ name: 'System', text: 'The vote was tied. Nobody was eliminated.', time: now(), system: true }); announce('The vote was tied', 'Nobody was eliminated. The night continues.', 'info') }
      const wolves = players.filter((player) => player.alive && player.role === 'Werewolf').length
      const villagers = players.filter((player) => player.alive && player.role !== 'Werewolf').length
      if (wolves === 0) { winner = 'village'; announce('The village wins', 'The last werewolf is gone.', 'success') }
      else if (wolves >= villagers) { winner = 'werewolves'; announce('The werewolves win', 'The wolves now control the village.', 'danger') }
      if (!winner) { phase = 'night'; night += 1; phaseEndsAt = Date.now() + 120_000 }
      votes.clear()
    }
    emitState()
  })

  socket.on('seer:inspect', (targetId: string) => {
    const seer = players.find((player) => player.id === socket.id)
    const target = players.find((player) => player.id === targetId)
    if (!seer || seer.role !== 'Seer' || phase !== 'night' || !target || !target.alive || target.id === seer.id) return
    inspections.get(socket.id)?.set(target.id, target.role)
    socket.emit('game:state', {
      room: ROOM, phase, phaseEndsAt, night, hostId, winner, lastEvent, pendingHunterId, players: publicPlayers(),
      me: { id: seer.id, name: seer.name, role: seer.role, alive: seer.alive },
      inspections: Object.fromEntries(inspections.get(socket.id) ?? []),
      myVote: votes.get(socket.id) ?? null,
      voteCounts: Object.fromEntries([...votes.values()].map((targetId) => [targetId, [...votes.values()].filter((value) => value === targetId).length])),
      myNightAction: nightActions.get(socket.id) ?? null,
      messages,
    })
  })

  socket.on('disconnect', () => {
    const index = players.findIndex((player) => player.id === socket.id)
    if (index >= 0) {
      const [leaver] = players.splice(index, 1)
      messages.push({ name: 'System', text: `${leaver.name} left the village.`, time: now(), system: true })
    }
    inspections.delete(socket.id)
    readyPlayers.delete(socket.id)
    votes.delete(socket.id)
    nightActions.delete(socket.id)
    if (pendingHunterId === socket.id) pendingHunterId = null
    if (hostId === socket.id) hostId = io.sockets.sockets.keys().next().value ?? ''
    emitState()
  })
})

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Millers Hollow server listening on port ${PORT}`))
