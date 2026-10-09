const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  'mr-mime': 'Mr. Mime',
  'mime-jr': 'Mime Jr.',
  farfetchd: "Farfetch'd",
  sirfetchd: "Sirfetch'd",
  'nidoran-f': 'Nidoran♀',
  'nidoran-m': 'Nidoran♂',
  flabebe: 'Flabébé',
}

export function formatPokemonName(name: string): string {
  const megaMatch = name.match(/^(.*)-mega(?:-([a-z0-9]+))?$/)
  if (megaMatch) {
    const baseName = formatPokemonName(megaMatch[1])
    const suffix = megaMatch[2] ? ' ' + megaMatch[2].toUpperCase() : ''
    return 'Mega ' + baseName + suffix
  }

  if (name.endsWith('-gmax')) {
    return formatPokemonName(name.slice(0, -5)) + ' Gigantamax'
  }

  if (DISPLAY_NAME_OVERRIDES[name]) return DISPLAY_NAME_OVERRIDES[name]
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatPokemonType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}
