# ByMon Online

## Arquitetura

- **Vercel + Redis** são o diretório de salas e o canal temporário de sinalização. Não hospedam a conexão de dados do lobby.
- **O navegador do anfitrião** mantém o estado temporário da sala: jogadores presentes, times, cores, pronto e início do lobby.
- **WebRTC DataChannel** transporta atualizações diretamente entre o anfitrião e cada participante depois que a conexão é negociada.
- A API de salas valida as sessões e armazena as ofertas, respostas e candidatos ICE no Redis até o navegador destinatário buscá-los.

A sala existe enquanto o host mantiver a página ativa e continuar renovando sua presença. Se o host sair normalmente, a API remove a sala. Se a página fechar sem sair, a presença expira após 30 segundos e a sala deixa de aparecer na lista pública.

## Configuração da Vercel

A API exige a variável de ambiente `REDIS_URL`. Configure-a para **Production**, **Preview** e **Development** no projeto Vercel. Sem essa variável, criação, entrada e listagem de salas retornarão erro de servidor.

Por padrão, o WebRTC usa um servidor STUN público. Redes restritivas podem exigir servidores TURN. Para isso, configure `VITE_WEBRTC_ICE_SERVERS` como JSON de uma lista de `RTCIceServer`, por exemplo:

```json
[
  { "urls": "stun:stun.example.com:3478" },
  {
    "urls": "turn:turn.example.com:3478",
    "username": "usuario",
    "credential": "credencial"
  }
]
```

Use credenciais TURN válidas do seu provedor; o exemplo acima é apenas estrutural.

## Fluxo implementado

1. O anfitrião cria uma sala pública ou privada. O Redis armazena o registro, o código, a sessão e o prazo de expiração.
2. Outros jogadores encontram salas públicas atualizadas a cada 3 segundos ou entram por código. Salas privadas não aparecem na lista e exigem senha.
3. O lobby atualiza a presença dos participantes a cada 2,5 segundos.
4. O host cria uma conexão WebRTC por participante e publica a oferta pelo canal de sinalização. O participante responde; candidatos ICE podem chegar antes da oferta e ficam em espera até ser possível aplicá-los.
5. Após abrir o DataChannel, o time local e sua cor são sincronizados. Mudanças no time cancelam o estado de pronto; o host controla a regra de início quando todos estão prontos.
6. A fila de sinalização é consumida atomicamente em lotes para evitar apagar candidatos que cheguem durante a leitura.
7. Se a conexão falhar, o cliente pode negociar uma nova conexão. Se um participante sair, o host remove sua conexão quando a lista de membros for atualizada.

## Limites atuais

- As salas permitem de 2 a 16 jogadores, mas cada jogador usa no máximo 6 Pokémon.
- Senhas são armazenadas como hash, nunca em texto puro.
- O estado do lobby é coordenado pelo host; os dados de sinalização permanecem temporariamente no Redis.
- A tela de batalha online sincronizada ainda é uma etapa separada. O lobby pode declarar que todos estão prontos, mas isto não significa que a simulação da batalha já esteja sincronizada entre navegadores.
