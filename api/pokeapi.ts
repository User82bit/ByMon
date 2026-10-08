const POKEAPI_BASE = 'https://pokeapi.co/api/v2'

const ALLOWED_ROOTS = ['/pokemon', '/type', '/pokedex', '/move']
const POKEAPI_ORIGIN = new URL(POKEAPI_BASE).origin

function parseRequestedPath(path: string): URL | null {
  try {
    return new URL(path, POKEAPI_ORIGIN)
  } catch {
    return null
  }
}

function isAllowedPath(path: string): boolean {
  const target = parseRequestedPath(path)

  if (!target || target.origin !== POKEAPI_ORIGIN) {
    return false
  }

  return ALLOWED_ROOTS.some(
    (root) => target.pathname === root || target.pathname.startsWith(root + '/'),
  )
}

function buildUpstreamUrl(path: string): URL {
  const target = parseRequestedPath(path)

  if (!target) {
    throw new Error('Caminho inválido.')
  }

  const upstream = new URL(POKEAPI_BASE)
  upstream.pathname =
    upstream.pathname.replace(/\/$/, '') + target.pathname
  upstream.search = target.search

  return upstream
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url)
    const path = requestUrl.searchParams.get('path')

    if (!path || !path.startsWith('/') || !isAllowedPath(path)) {
      return Response.json(
        { error: 'Caminho da PokéAPI inválido.' },
        { status: 400 },
      )
    }

    try {
      const upstream = await fetch(buildUpstreamUrl(path), {
        headers: {
          Accept: 'application/json',
        },
      })

      const body = await upstream.arrayBuffer()

      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      })
    } catch {
      return Response.json(
        { error: 'Não foi possível acessar a PokéAPI.' },
        { status: 502 },
      )
    }
  },
}
