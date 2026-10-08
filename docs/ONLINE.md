# ByMon Online

O ByMon possui três modos de armazenamento das salas:

- **Local:** usado quando o site está em `localhost`. As salas ficam no `localStorage` e servem para testar em abas do mesmo navegador.
- **LAN:** usado automaticamente quando o site é aberto por um endereço privado da rede, como `192.168.x.x`, `10.x.x.x` ou `.local`. O próprio servidor de desenvolvimento do Vite mantém as salas em memória, sem Redis e sem serviço externo.
- **Servidor:** quando `VITE_ONLINE_API_URL` está configurada, o frontend usa a API online real.

## Teste pela LAN

Na máquina que vai hospedar a sala:

```bash
npm install
npm run dev:lan
```

O comando inicia o Vite escutando em todas as interfaces de rede. O Vite permite usar `--host 0.0.0.0` para disponibilizar o servidor na LAN.

Depois, descubra o IPv4 da máquina na rede, por exemplo `192.168.1.20`, e abra:

```
http://192.168.1.20:5173
```

Os outros dispositivos conectados à mesma rede abrem **essa mesma URL**. As salas públicas passam a ser compartilhadas entre eles, e o lobby sincroniza por polling.

O servidor LAN fica dentro do processo do Vite durante o desenvolvimento. Ele não é um backend externo nem precisa de Redis.

## Servidor online real

A API de produção continua usando a variável de ambiente `REDIS_URL`. No projeto da Vercel, adicione uma integração Redis pelo Marketplace e deixe a variável disponível para Development, Preview e Production.

## Fluxo implementado

- criação de sala pública ou privada;
- limite de 2 a 16 jogadores;
- senha protegida no fluxo de servidor;
- listagem de salas públicas;
- entrada por botão;
- entrada por código;
- transferência automática do host quando ele sai;
- remoção de jogadores inativos;
- lobby com status de pronto;
- cada jogador monta seu próprio time dentro do lobby;
- a partida muda para o estado `battle` quando todos os jogadores estão prontos;
- atualização automática da lista e do lobby a cada 3 segundos.

## Observação

O modo LAN é para desenvolvimento e testes na mesma rede. Ele mantém o estado somente enquanto o processo do Vite estiver rodando. Para partidas pela internet, sem os jogadores estarem na mesma rede, continua sendo necessário um serviço de sinalização/servidor acessível externamente.
