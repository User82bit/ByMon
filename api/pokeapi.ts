const POKEAPI_BASE = 'https://pokeapi.co/api/v2'

const ALLOWED_ROOTS = ['/pokemon', '/type']

function isAllowedPath(path: string): boolean {
  return ALLOWED_ROOTS.some((root) => path === root || path.startsWith(root + '/'))
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
      const upstream = await fetch(POKEAPI_BASE + path, {
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
