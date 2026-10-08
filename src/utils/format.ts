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
  if (DISPLAY_NAME_OVERRIDES[name]) return DISPLAY_NAME_OVERRIDES[name]
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatPokemonType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}
