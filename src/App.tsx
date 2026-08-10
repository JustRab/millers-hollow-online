import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { Moon, Sun, Send, Shield, Eye, Mic, Volume2, Copy, Check, Users, DoorOpen, ChevronRight, Skull, ScrollText, Settings2 } from 'lucide-react'

type Phase = 'lobby' | 'night' | 'day'
type Player = { id: string; name: string; alive: boolean }
type Message = { name: string; text: string; time: string; system?: boolean }
type GameEvent = { id: number; title: string; detail: string; tone: 'info' | 'danger' | 'success' }
type DeathCause = 'voted' | 'night' | null
type GameState = {
  room: string
  phase: Phase
  phaseEndsAt: number
  night: number
  hostId: string
  winner: 'village' | 'werewolves' | null
  lastEvent: GameEvent | null
  pendingHunterId: string | null
  players: Player[]
  me: { id: string; name: string; role: string; alive: boolean } | null
  inspections: Record<string, string>
  myVote: string | null
  myNightAction: string | null
  voteCounts: Record<string, number>
  messages: Message[]
}

const socket: Socket = io()
let sharedAudioContext: AudioContext | null = null

function primeAudio() {
  if (!window.AudioContext) return
  sharedAudioContext ??= new window.AudioContext()
  void sharedAudioContext.resume()
}

type SoundCue = 'join' | 'chat' | 'vote' | 'action' | 'protect' | 'phase' | 'death' | 'tie' | 'success' | 'danger' | 'info'

function playUiSound(kind: SoundCue, enabled: boolean) {
  if (!enabled) return
  if (!window.AudioContext) return
  sharedAudioContext ??= new window.AudioContext()
  const audioContext = sharedAudioContext
  if (audioContext.state === 'suspended') void audioContext.resume()
  const patterns: Record<SoundCue, { notes: number[]; type: OscillatorType; gap: number; length: number }> = {
    join: { notes: [262, 392, 523], type: 'sine', gap: .09, length: .2 },
    chat: { notes: [660, 880], type: 'sine', gap: .06, length: .1 },
    vote: { notes: [220, 277], type: 'triangle', gap: .08, length: .16 },
    action: { notes: [330, 440], type: 'square', gap: .07, length: .13 },
    protect: { notes: [392, 523, 659], type: 'sine', gap: .1, length: .2 },
    phase: { notes: [196, 294, 392], type: 'triangle', gap: .12, length: .24 },
    death: { notes: [196, 147, 110], type: 'sawtooth', gap: .13, length: .3 },
    tie: { notes: [294, 294], type: 'square', gap: .16, length: .12 },
    success: { notes: [392, 494, 587, 784], type: 'sine', gap: .09, length: .24 },
    danger: { notes: [165, 123, 92], type: 'sawtooth', gap: .14, length: .3 },
    info: { notes: [330], type: 'sine', gap: 0, length: .18 },
  }
  const pattern = patterns[kind]
  const start = audioContext.currentTime + .01
  pattern.notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const noteStart = start + index * pattern.gap
    oscillator.type = pattern.type
    oscillator.frequency.setValueAtTime(frequency, noteStart)
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'death' || kind === 'danger' ? .72 : 1.04), noteStart + pattern.length)
    gain.gain.setValueAtTime(.0001, noteStart)
    gain.gain.exponentialRampToValueAtTime(kind === 'danger' || kind === 'death' ? .055 : .07, noteStart + .012)
    gain.gain.exponentialRampToValueAtTime(.0001, noteStart + pattern.length)
    oscillator.connect(gain).connect(audioContext.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteStart + pattern.length + .02)
  })
}

function eventSound(title: string, tone: GameEvent['tone']): SoundCue {
  const normalized = title.toLowerCase()
  if (normalized.includes('voted') || normalized.includes('died') || normalized.includes('fired')) return 'death'
  if (normalized.includes('tie')) return 'tie'
  if (normalized.includes('protect')) return 'protect'
  if (normalized.includes('win')) return tone === 'success' ? 'success' : 'danger'
  if (normalized.includes('night') || normalized.includes('daylight') || normalized.includes('game begins') || normalized.includes('awake')) return 'phase'
  return tone
}

function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [nameDraft, setNameDraft] = useState(() => localStorage.getItem('millers-name') ?? '')
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const [connected, setConnected] = useState(socket.connected)
  const [audioEnabled, setAudioEnabled] = useState(() => localStorage.getItem('millers-audio') !== 'off')
  const [notice, setNotice] = useState<GameEvent | { id: number; title: string; detail: string; tone: 'info' } | null>(null)
  const [deathCause, setDeathCause] = useState<DeathCause>(null)
  const seenEvent = useRef(0)
  const wasAlive = useRef<boolean | null>(null)

  useEffect(() => {
    const handleConnect = () => setConnected(true)
    const handleDisconnect = () => setConnected(false)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('game:state', (nextState: GameState) => {
      if (wasAlive.current === true && nextState.me && !nextState.me.alive) {
        setDeathCause(nextState.lastEvent?.title.includes('voted out') ? 'voted' : 'night')
      }
      wasAlive.current = nextState.me?.alive ?? null
      setState(nextState)
      if (nextState.lastEvent && nextState.lastEvent.id > seenEvent.current) {
        seenEvent.current = nextState.lastEvent.id
        setNotice(nextState.lastEvent)
        playUiSound(eventSound(nextState.lastEvent.title, nextState.lastEvent.tone), audioEnabled)
        window.setTimeout(() => setNotice((current) => current?.id === nextState.lastEvent?.id ? null : current), 4200)
      }
    })
    socket.on('game:action-confirmed', (event: { title: string; detail: string }) => {
      const confirmation = { ...event, id: Date.now(), tone: 'info' as const }
      setNotice(confirmation)
      playUiSound(event.title.toLowerCase().includes('vote') ? 'vote' : event.title.toLowerCase().includes('protection') ? 'protect' : 'action', audioEnabled)
      window.setTimeout(() => setNotice((current) => current?.id === confirmation.id ? null : current), 3200)
    })
    socket.on('chat:received', () => playUiSound('chat', audioEnabled))
    return () => { socket.off('connect', handleConnect); socket.off('disconnect', handleDisconnect); socket.off('game:state'); socket.off('game:action-confirmed'); socket.off('chat:received') }
  }, [audioEnabled])

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [])

  const joinGame = () => {
    const cleanName = nameDraft.trim().slice(0, 18)
    if (!cleanName) return
    primeAudio()
    playUiSound('join', audioEnabled)
    localStorage.setItem('millers-name', cleanName)
    const room = new URLSearchParams(window.location.search).get('room') || 'MILL-7Q2'
    socket.emit('room:join', { name: cleanName, room })
  }

  if (!state || !state.me) {
    return <main className="app night join-screen"><div className="join-card"><div className="brand"><span className="brand-mark"><Moon size={17} fill="currentColor" /></span><span>Millers Hollow</span></div><span className="section-label">JOIN THE VILLAGE</span><h1>Choose your name</h1><p>This is how the village will know you. You can change it before joining.</p><div className="join-form"><input autoFocus maxLength={18} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && joinGame()} placeholder="Your village name" /><button className="primary-btn" disabled={!nameDraft.trim()} onClick={joinGame}>Enter the village <ChevronRight size={16} /></button></div></div></main>
  }

  const { me, phase } = state
  const isLobby = phase === 'lobby'
  const isDead = !me.alive
  const selectedPlayer = state.players.find((player) => player.id === selected)
  const inspectedRole = selected ? state.inspections[selected] : undefined
  const isHost = state.hostId === me.id
  const canHunterAct = me.role === 'Hunter' && state.pendingHunterId === me.id
  const secondsLeft = Math.max(0, Math.ceil((state.phaseEndsAt - clock) / 1000))
  const timerText = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`
  const toggleAudio = () => { const next = !audioEnabled; setAudioEnabled(next); localStorage.setItem('millers-audio', next ? 'on' : 'off') }
  const copyRoom = async () => { await navigator.clipboard?.writeText(`${window.location.origin}?room=${state.room}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }
  const sendMessage = () => { const text = draft.trim(); if (!text) return; socket.emit('chat:send', text); setDraft('') }
  const inspect = () => {
    if (!selectedPlayer) return
    if (canHunterAct) socket.emit('hunter:shoot', selectedPlayer.id)
    else if (me.role === 'Werewolf' || me.role === 'Doctor') socket.emit('night:action', selectedPlayer.id)
    else socket.emit('seer:inspect', selectedPlayer.id)
  }
  const submitVote = () => { if (selectedPlayer) socket.emit('vote:submit', selectedPlayer.id) }
  const voteTotal = Object.values(state.voteCounts).reduce((total, count) => total + count, 0)
  const livingCount = state.players.filter((player) => player.alive).length

  return (
    <main className={`${phase === 'night' ? 'app night' : phase === 'day' ? 'app day' : 'app lobby'} ${isDead ? 'spectator-mode' : ''} ${deathCause ? `death-${deathCause}` : ''}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Moon size={17} fill="currentColor" /></span><span>Millers Hollow</span><span className="brand-tag">ONLINE</span></div>
        <div className="room-pill"><span className="live-dot" /> ROOM <strong>{state.room}</strong><button onClick={copyRoom} aria-label="Copy room code">{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
        <div className="top-actions"><button className={`icon-btn ${audioEnabled ? '' : 'muted'}`} onClick={toggleAudio} aria-label={audioEnabled ? 'Mute event sounds' : 'Enable event sounds'} title={audioEnabled ? 'Mute event sounds' : 'Enable event sounds'}>{audioEnabled ? <Volume2 size={18} /> : <Volume2 size={18} />}</button><button className="icon-btn" aria-label="Game settings"><Settings2 size={18} /></button><div className="profile-mini">{me.name.slice(0, 2).toUpperCase()}</div></div>
      </header>

      <section className="game-layout">
        {!connected && <div className="connection-banner" role="alert"><span className="connection-pulse" /><div><strong>Connection lost</strong><span>The village is waiting. Your game state will resync when you reconnect.</span></div><button onClick={() => socket.connect()}>Reconnect</button></div>}
        {notice && <div className={`game-notice notice-${notice.tone}`} role="status"><span className="notice-mark">{notice.tone === 'danger' ? '!' : notice.tone === 'success' ? '✓' : '·'}</span><div><strong>{notice.title}</strong><span>{notice.detail}</span></div><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
        <aside className="left-rail">
          <div className="eyebrow"><span className="live-dot" /> {isLobby ? 'ROOM OPEN' : `NIGHT ${String(state.night).padStart(2, '0')}`}</div>
          <div className="phase-title"><span className="phase-icon">{phase === 'night' ? <Moon size={28} fill="currentColor" /> : phase === 'day' ? <Sun size={28} /> : <Users size={28} />}</span><div><h1>{isLobby ? 'Gather the village' : phase === 'night' ? 'The village sleeps' : 'The village wakes'}</h1><p>{isLobby ? 'Everyone is here. Waiting for the host.' : phase === 'night' ? 'Choose your target in secret.' : 'Talk. Watch. Decide together.'}</p></div></div>
          <div className="timer"><div><span className="timer-label">{isLobby ? 'PLAYERS IN ROOM' : 'PHASE ENDS IN'}</span><strong>{isLobby ? state.players.length : timerText}</strong></div><div className="timer-ring">{isLobby ? 'L' : phase === 'night' ? 'N' : 'D'}</div></div>
          <div className="role-card"><div className="role-kicker"><Eye size={14} /> YOUR ROLE</div><div className="role-name">{me.role}</div><p>{me.role === 'Seer' ? 'Each night, learn the true identity of one player.' : 'Work with your team and survive until the end.'}</p><div className="role-secret"><Shield size={15} /><span>Only you can see this</span></div></div>
          <div className="objective"><span className="section-label">YOUR OBJECTIVE</span><p>{me.role === 'Werewolf' ? 'Stay hidden and eliminate the village.' : 'Find the wolves before they outnumber the village.'}</p></div>
          {isLobby && isHost && <button className="secondary-btn" onClick={() => socket.emit('game:start')}><Sun size={16} /> Start game<ChevronRight size={15} /></button>}
          {!isLobby && isHost && !state.winner && <button className="secondary-btn" disabled={isDead} onClick={() => socket.emit('phase:toggle')}>{phase === 'night' ? <Sun size={16} /> : <Moon size={16} />}{phase === 'night' ? 'Start day phase' : 'Start night phase'}<ChevronRight size={15} /></button>}
        </aside>

        <section className="board-area">
          {isDead && <div className="spectator-banner"><Skull size={19} /><div><span className="section-label">{canHunterAct ? 'FINAL MOMENT' : 'YOU ARE OUT'}</span><strong>{canHunterAct ? 'The Hunter gets one final shot.' : deathCause === 'voted' ? 'The village voted against you.' : 'The night claimed you.'}</strong><p>{canHunterAct ? 'Choose one living player before you leave the village.' : 'You can watch the village, but your actions are locked.'}</p></div></div>}
          {isLobby && <div className="lobby-banner"><span className="winner-sigil">L</span><div><span className="section-label">WAITING ROOM</span><strong>{isHost ? 'You are the host.' : 'Waiting for the host to start.'}</strong><p>The game will begin when everyone is ready.</p></div></div>}
          {state.winner && <div className="winner-banner"><span className="winner-sigil">{state.winner === 'village' ? 'V' : 'W'}</span><div><span className="section-label">GAME OVER</span><strong>{state.winner === 'village' ? 'The village survives.' : 'The werewolves take the village.'}</strong></div>{isHost && <button className="rematch-btn" onClick={() => socket.emit('game:reset')}>Play again</button>}</div>}
          <div className="board-heading"><div><span className="eyebrow">LIVE VILLAGE</span><h2>Who is still standing?</h2></div><div className="player-count"><Users size={16} /> <strong>{livingCount}</strong> alive <span>/</span> {state.players.length} total</div></div>
          <div className="roster">
            {state.players.map((player) => <button key={player.id} className={`player-tile ${selected === player.id ? 'selected' : ''} ${!player.alive ? 'dead' : ''} ${player.id === me.id ? 'self' : ''}`} onClick={() => player.alive && player.id !== me.id && setSelected(player.id)} disabled={!player.alive}><div className="avatar">{player.name.slice(0, 2).toUpperCase()}{player.alive && <span className="status-dot" />}</div><div className="player-info"><strong>{player.name}</strong><span>{player.id === me.id ? 'That’s you' : player.alive ? 'In the village' : 'Lost to the night'}</span></div>{phase === 'day' && player.alive && state.voteCounts[player.id] > 0 && <span className="vote-count">{state.voteCounts[player.id]} vote{state.voteCounts[player.id] === 1 ? '' : 's'}</span>}{player.id === me.id ? <span className="you-label">YOU</span> : !player.alive ? <Skull size={16} className="skull" /> : <span className="target-mark">{selected === player.id ? 'TARGET' : ''}</span>}</button>)}
          </div>

          {phase === 'day' && !state.winner && <div className="action-panel vote-panel"><div className="action-head"><div><span className="section-label">DAY VOTE</span><h3>{state.myVote ? 'Vote submitted' : `Accuse ${selectedPlayer?.name ?? 'a player'}`}</h3></div><div className="action-badge"><Users size={15} /> PUBLIC</div></div><div className="vote-progress"><div className="vote-progress-label"><span>{voteTotal} of {livingCount} votes cast</span><span>{voteTotal === livingCount ? 'Resolving...' : 'Waiting for the village'}</span></div><div className="vote-progress-track"><span style={{ width: `${livingCount ? (voteTotal / livingCount) * 100 : 0}%` }} /></div></div><p className="action-copy">Choose who you believe is a werewolf. Your vote is visible to the village.</p><button className="primary-btn" disabled={isDead || !selectedPlayer || !!state.myVote} onClick={submitVote}><Users size={17} /> {isDead ? 'Spectating' : state.myVote ? `Voted for ${state.players.find((player) => player.id === state.myVote)?.name ?? 'a player'}` : 'Submit vote'}</button></div>}

          {!isLobby && <div className="action-panel"><div className="action-head"><div><span className="section-label">{me.role.toUpperCase()} ACTION</span><h3>{canHunterAct ? 'Choose your final shot' : isDead ? 'No actions available' : me.role === 'Werewolf' || me.role === 'Doctor' ? (state.myNightAction ? 'Night action submitted' : `Choose ${me.role === 'Werewolf' ? 'a victim' : 'someone to protect'}`) : inspectedRole ? 'Vision received' : `Inspect ${selectedPlayer?.name ?? 'a player'}`}</h3></div><div className="action-badge"><Eye size={15} /> SECRET</div></div>{canHunterAct ? <><p className="action-copy">You were eliminated, but the Hunter gets one final shot before leaving the village.</p><button className="primary-btn" disabled={!selectedPlayer} onClick={inspect}><Eye size={17} /> Fire at {selectedPlayer?.name ?? 'a player'}</button></> : isDead ? <p className="action-copy">Your role has been revealed to you, but you can no longer affect the living village.</p> : me.role === 'Werewolf' || me.role === 'Doctor' ? <><p className="action-copy">{state.myNightAction ? 'Your hidden choice has been received by the game master.' : 'Choose one living player. Your role action is private.'}</p><button className="primary-btn" disabled={phase !== 'night' || !selectedPlayer || !!state.myNightAction} onClick={inspect}><Eye size={17} /> {state.myNightAction ? 'Action submitted' : me.role === 'Werewolf' ? 'Choose victim' : 'Protect player'}</button></> : inspectedRole ? <div className="vision-result"><div className="vision-sigil">{inspectedRole === 'Werewolf' ? 'W' : 'V'}</div><div><strong>{selectedPlayer?.name}</strong><p>This player is a <b>{inspectedRole}</b>.</p></div><button className="reset-action" onClick={() => setSelected('')}>Inspect again</button></div> : <><p className="action-copy">Select one living player to reveal their role. The village will not be notified.</p><button className="primary-btn" disabled={me.role !== 'Seer' || phase !== 'night' || !selectedPlayer} onClick={inspect}><Eye size={17} /> Reveal {selectedPlayer ? selectedPlayer.name + "'s role" : 'a player'}</button></>}</div>}
          <div className="log-row"><ScrollText size={16} /><span><b>Game log</b> · Night {String(state.night).padStart(2, '0')} began</span><ChevronRight size={15} /></div>
        </section>

        <aside className="chat-panel"><div className="chat-head"><div><span className="section-label">VILLAGE CHAT</span><h2>Town square <span className="online-count">{state.players.length} online</span></h2></div><button className="icon-btn"><Mic size={17} /></button></div><div className="chat-messages">{state.messages.map((message, index) => <div className={`message ${message.system ? 'system-message' : ''}`} key={`${message.time}-${index}`}><div className="message-meta"><strong>{message.name}</strong><span>{message.time}</span></div><p>{message.text}</p></div>)}</div><div className="chat-compose"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sendMessage()} placeholder="Say something to the village..." /><button onClick={sendMessage} aria-label="Send message"><Send size={17} /></button></div><div className="chat-foot"><DoorOpen size={14} /> Room is invite-only <span>·</span> <button onClick={copyRoom}>Invite players</button></div></aside>
      </section>
      <footer className="footer"><span>Millers Hollow Online</span><span>Room host: <b>{isHost ? 'You' : 'Another player'}</b></span><span className={`connection ${connected ? '' : 'offline'}`}><span className="live-dot" /> {connected ? 'Connected' : 'Offline'}</span></footer>
    </main>
  )
}

export default App
