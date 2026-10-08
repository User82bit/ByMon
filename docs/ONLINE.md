# ByMon Online

O ByMon possui três caminhos para as salas:

- **Local:** quando não existe serviço LAN nem API configurada, a sala usa o `localStorage` do navegador. É o modo para testar várias abas no mesmo navegador.
- **LAN:** quando o servidor local do ByMon está disponível, cada instância anuncia suas salas na rede Wi-Fi por UDP. A página Online faz uma busca LAN e mostra as salas encontradas com a tag **LAN**.
- **Servidor:** quando `VITE_ONLINE_API_URL` está configurada, o frontend usa a API online real.

## Teste LAN

Na máquina que vai hospedar uma party, execute:

```bash
npm install
npm run dev:lan
```

O servidor precisa estar acessível na rede local. O comando `dev:lan` inicia o Vite com `--host 0.0.0.0`.

Depois, abra o ByMon normalmente na máquina host. Quando uma sala é criada, ela fica hospedada no processo local e é anunciada automaticamente na rede.

Em outra máquina da mesma rede, abra o ByMon usando o endereço da máquina host, por exemplo:

```
http://192.168.1.20:5173
```

Ao entrar na página **Online**, o ByMon envia uma solicitação de descoberta na LAN. As máquinas que possuem salas respondem com seus dados públicos, e as salas encontradas aparecem com a tag **LAN**.

## Como a entrada funciona

O navegador não precisa acessar diretamente o IP de outro jogador.

A máquina que está exibindo o ByMon possui um pequeno relay local. Quando você entra em uma sala LAN, o relay encaminha a criação/entrada, heartbeat, atualização do time, pronto e saída para a máquina que realmente hospeda aquela sala.

Isso permite que a sala continue pertencendo ao host original, mesmo quando os jogadores estão em computadores diferentes.

## Descoberta

O protocolo LAN usa UDP:

- porta de descoberta: `41234`;
- anúncios periódicos de aproximadamente 2,5 segundos;
- cada anúncio expira depois de aproximadamente 9 segundos sem atualização;
- uma busca manual também dispara um `probe`, fazendo os hosts anunciarem imediatamente suas salas;
- salas privadas não aparecem na lista pública, mas continuam sendo resolvíveis pelo código da sala;
- nenhum password é colocado no anúncio UDP.

## Limitações

O modo LAN é destinado a computadores na mesma rede local. O Wi-Fi precisa permitir comunicação entre os dispositivos; redes com isolamento de clientes podem bloquear a descoberta.

O estado LAN fica na memória do processo local do Vite. Encerrar o servidor encerra as salas LAN.

Para partidas pela internet, fora da mesma rede, continua sendo necessário um serviço acessível externamente.
