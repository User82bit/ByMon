import { useEffect, useState, type CSSProperties } from 'react'
import type { BattleEvent, BattleResult, PokemonBattleData, PokemonKind, Team } from '../../types/pokemon'
import { Button } from '../../components/ui/Button'
import { TypeBadge } from '../../components/ui/TypeBadge'
import { formatPokemonName } from '../../utils/format'
import './Battle.css'

function variantLabel(kind: PokemonKind): string | null {
  if (kind === 'mega') return 'Mega Evolução'
  if (kind === 'gmax') return 'Gigantamax'
  return null
}

function useBattlePlayback(events: BattleEvent[]) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    if (!playing || index >= events.length - 1) return
    const timer = window.setTimeout(() => setIndex(value => Math.min(value + 1, events.length - 1)), 1200)
    return () => window.clearTimeout(timer)
  }, [events.length, index, playing])
  return { index, setIndex, playing, setPlaying }
}

export function Battle({ result, onReturn }: { result: BattleResult; teams: Team[]; details: Map<number, PokemonBattleData>; onReturn: () => void }) {
  const playback = useBattlePlayback(result.events)
  const event = result.events[playback.index]
  const actor = event?.attacker
  const defender = event?.defender
  const done = playback.index >= result.events.length - 1
  const hpFor = (id: number, teamId: string, fallback: number) => {
    let hp = fallback
    for (let i = 0; i <= playback.index; i += 1) {
      const e = result.events[i]
      if (e.defender?.id === id && e.defender.teamId === teamId && typeof e.hpAfter === 'number') hp = e.hpAfter
    }
    return hp
  }
  function fighterCard(value: typeof actor, isAttacker: boolean) {
    if (!value) return null
    const hp = hpFor(value.id, value.teamId, value.maxHp)
    const defeated = hp <= 0
    return <article className={'battle-card' + (value.kind === 'normal' ? '' : ' is-' + value.kind) + (defeated ? ' is-defeated' : '') + (isAttacker ? ' is-active' : '')} style={{ '--team-color': value.teamColor } as CSSProperties} key={value.id}>
      <img src={value.imageUrl} alt={formatPokemonName(value.name)} />
      <h2>{formatPokemonName(value.name.replace(/-gmax$/, ''))}</h2>
      {variantLabel(value.kind) && <span className={'variant-chip' + (value.kind === 'mega' ? ' variant-chip--mega' : '')}>{variantLabel(value.kind)}</span>}
      <strong>{value.teamName}</strong>
      <div className="battle-card__types">{value.types.map(type => <TypeBadge key={type} type={type} />)}</div>
      <div className="hp-track"><span style={{ width: Math.max(0, hp / value.maxHp * 100) + '%' }} /></div>
      <small>HP {hp} / {value.maxHp}</small>
      {defeated && <b className="defeated-label">Derrotado</b>}
    </article>
  }
  return <main className="battle">
    <header className="battle__header"><div><h1>{done ? result.winnerTeamName + ' venceu' : 'Batalha'}</h1><p>{done ? 'Resultado final' : 'Turno ' + (result.events.slice(0, playback.index + 1).filter(e => e.kind === 'turn' || e.kind === 'miss').length + 1)}</p></div><div className="battle__controls"><Button onClick={() => playback.setPlaying(!playback.playing)}>{playback.playing ? 'Pausar' : 'Retomar'}</Button><Button variant="secondary" onClick={onReturn}>Voltar</Button></div></header>
    {!done && <section className="battle-arena">{fighterCard(actor, true)}<div className="battle-vs"><b>VS</b><strong>{event?.move?.name ?? event?.title}</strong>{event?.damage !== undefined && <span>−{event.damage}</span>}{event?.critical && <small>Acerto crítico!</small>}{event?.effectiveness === 0 && <small>Não afeta</small>}</div>{fighterCard(defender, false)}</section>}
    {done && <section className="battle-result"><h2>Time vencedor: {result.winnerTeamName}</h2><div>{result.remaining.filter(p => p.teamId === result.winnerTeamId).map(p => <article key={p.teamId + p.pokemonName} style={{ '--team-color': p.teamColor } as CSSProperties}><img src={p.imageUrl} alt={formatPokemonName(p.pokemonName)} /><strong>{formatPokemonName(p.pokemonName)}</strong><span>HP {p.currentHp}/{p.maxHp}</span></article>)}</div></section>}
    <section className="log"><h2>Histórico da batalha</h2>{result.events.slice(0, playback.index + 1).map(e => <div className={'event event-' + e.kind} key={e.id}>{e.attacker && <img className={e.attacker.kind === 'mega' ? 'event__pokemon event__pokemon--mega' : e.attacker.kind === 'gmax' ? 'event__pokemon event__pokemon--gmax' : 'event__pokemon'} src={e.attacker.imageUrl} alt="" />}<div><b>{e.title}</b><p>{e.detail}</p></div>{e.defender && <img className={e.defender.kind === 'mega' ? 'event__pokemon event__pokemon--mega' : e.defender.kind === 'gmax' ? 'event__pokemon event__pokemon--gmax' : 'event__pokemon'} src={e.defender.imageUrl} alt="" />}</div>)}</section>
  </main>
}
