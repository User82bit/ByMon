# ByMon Online

A primeira camada do modo online usa salas persistentes no Redis.

## Vercel

A API usa a variável de ambiente `REDIS_URL`. No projeto da Vercel, adicione uma integração Redis pelo Marketplace e deixe a variável disponível para Development, Preview e Production.

A documentação atual da Vercel orienta conectar Redis pelo Marketplace e usar `REDIS_URL` no projeto.

## Fluxo implementado

- criação de sala pública ou privada;
- limite de 2 a 16 jogadores;
- senha armazenada somente como hash;
- listagem de salas públicas;
- entrada por botão;
- entrada por código;
- transferência automática do host quando ele sai;
- remoção de jogadores que ficam mais de 30 segundos sem atualizar a sessão;
- lobby com status de pronto;
- atualização automática da lista e do lobby a cada 3 segundos.

## Próxima camada

A sala já possui estado persistente e um lobby separado da batalha. A próxima etapa é sincronizar os times e transformar o estado da batalha em um estado autoritativo do servidor.

A implementação atual usa polling para sincronização. O WebSocket pode ser adicionado depois sem mudar o formato básico das salas.
