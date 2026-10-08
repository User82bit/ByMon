import type { DragEvent } from 'react'
import React from 'react'
import { Button } from '../ui/Button'
import { TypeBadge } from '../ui/TypeBadge'
import { formatPokemonName } from '../../utils/format'
import type { PokemonSummary, Team as TeamModel } from '../../types/pokemon'
import './Team.css'

interface Props {
  team: TeamModel
  index: number
  canRemove: boolean
  onRename: (id: string, name: string) => void
  onChangeColor: (id: string, color: string) => void
  onRemove: (id: string) => void
  onDropPokemon: (id: string, pokemon: PokemonSummary) => void
  onRemovePokemon: (id: string, pokemonId: number) => void
}

export function Team({ team, index, canRemove, onRename, onChangeColor, onRemove, onDropPokemon, onRemovePokemon }: Props) {
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const raw = event.dataTransfer.getData('application/x-bymon-pokemon')
    if (!raw) return
    try { onDropPokemon(team.id, JSON.parse(raw) as PokemonSummary) } catch { /* payload inválido */ }
  }

  return (
    <section className="team-panel" style={{ "--team-color": team.color } as React.CSSProperties} onDragOver={handleDragOver} onDrop={handleDrop} aria-label={'Time ' + (index + 1)}>
      <div className="team-panel__header">
        <input className="team-panel__name" value={team.name} onChange={(e) => onRename(team.id, e.target.value)} maxLength={24} />
        <div className="team-panel__colors" aria-label="Cor do time">{["#E53935","#1E88E5","#43A047","#FB8C00","#8E24AA","#EC407A","#00ACC1","#FDD835","#6D4C41","#546E7A"].map(color => <button key={color} type="button" className={team.color.toLowerCase() === color.toLowerCase() ? "selected" : ""} style={{ backgroundColor: color }} onClick={() => onChangeColor(team.id, color)} aria-label={"Usar cor " + color} aria-pressed={team.color.toLowerCase() === color.toLowerCase()} />)}<label title="Cor personalizada">＋<input type="color" value={team.color} onChange={event => onChangeColor(team.id, event.target.value)} aria-label="Cor personalizada do time" /></label></div><span className="team-panel__count">{team.pokemon.length}/6</span>
        {canRemove && <Button variant="danger" className="team-panel__remove" onClick={() => onRemove(team.id)}>Remover</Button>}
      </div>
      <div className="team-panel__hint">Arraste Pokémon para esta área. Um Pokémon não pode se repetir no mesmo time.</div>
      <div className="team-panel__slots">
        {Array.from({ length: 6 }).map((_, slotIndex) => {
          const pokemon = team.pokemon[slotIndex]
          return (
            <div className="team-panel__slot" key={slotIndex}>
              {pokemon ? (
                <div className="team-panel__pokemon">
                  <button type="button" className="team-panel__remove-pokemon" onClick={() => onRemovePokemon(team.id, pokemon.id)} aria-label={'Remover ' + formatPokemonName(pokemon.name)}>×</button>
                  <img src={pokemon.imageUrl} alt={formatPokemonName(pokemon.name)} />
                  <strong>{formatPokemonName(pokemon.name)}</strong>
                  <div className="team-panel__types">{pokemon.types.map((type) => <TypeBadge key={type} type={type} />)}</div>
                </div>
              ) : <span>Slot {slotIndex + 1}</span>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
