# PromoSys · Backend do programa de fidelidade

API em **Node.js (ES Modules) + Fastify + MySQL** para programa de fidelidade de
**varejo físico** (PDV/loja): cadastro de clientes, acúmulo de pontos por compra,
extrato, validade dos pontos e resgate de recompensas.

Projetada para o cenário real de loja: muitos caixas gravando ao mesmo tempo,
picos em datas promocionais e tolerância zero a saldo de pontos inconsistente.

---

## Stack

| Camada | Escolha | Motivo |
| --- | --- | --- |
| Runtime | Node.js >= 20.11 (ESM) | `--env-file`, `--watch`, `node:test` nativos |
| HTTP | Fastify 5 | ~3x mais throughput que Express, validação e serialização por schema |
| Banco | MySQL 8 + `mysql2/promise` (Pool) | Reaproveitamento de conexão e prepared statements |
| Validação | Zod + `fastify-type-provider-zod` | 1 schema = validação + tipos + OpenAPI |
| Auth | JWT (HS512) + refresh token rotativo | Access curto e sem estado; revogação via refresh |
| Senhas | bcrypt | Custo configurável (`BCRYPT_ROUNDS`) |
| Log | Pino | JSON estruturado, com redação de campos sensíveis |
| Docs | @fastify/swagger | OpenAPI 3 gerado dos schemas Zod |

---

## Requisitos

- Node.js 20.11+
- npm
- MySQL/MariaDB iniciado pelo XAMPP
- Git

## Início rápido

```bash
# 1) Instale as dependências do backend
npm install

# 2) Crie o ambiente local
cp .env.example .env
# ajuste os segredos JWT e a conexão com o MySQL antes de subir a API

# 3) Inicie o MySQL no painel do XAMPP

# 4) Crie o banco, aplique as migrações e popular dados base
npm run db:create
npm run migrate
npm run seed

# 5) Suba a API
npm run dev
```

A API fica disponível em:

- API: http://localhost:3333/api/v1
- Health: http://localhost:3333/api/v1/health/live
- Swagger/OpenAPI: http://localhost:3333/docs

### Frontend em desenvolvimento

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

A aplicação web fica em:

- Frontend: http://127.0.0.1:5173

### Relatórios e filtros

Os relatórios são alimentados pelo banco local e respeitam o escopo de unidade
do perfil autenticado. As vendas exibidas correspondem às compras registradas
no livro-razão de pontos; não representam o faturamento completo do sistema de
caixa externo.

- `GET /api/v1/relatorios/financeiro`: totais e movimentos com filtros `de`, `ate`, `unidadeId`, `tipo`, `origem` e `busca`.
- `GET /api/v1/relatorios/pontos-clientes`: saldo atual com filtros `busca`, `nivel`, `ativo`, `pontosMin`, `pontosMax`, `ordenarPor` e `unidadeId`.
- `GET /api/v1/relatorios/unidades`: vendas identificadas, pontos por compra, transações e novos cadastros, filtrados por período/unidade.
- `GET /api/v1/clientes`: inclui filtros por nível, unidade de cadastro, cidade, UF, faixa de pontos e ordenação.
- `GET /api/v1/resgates`: inclui busca por código/cliente/recompensa e intervalo de datas; perfis de loja ficam limitados à própria unidade.

### Conciliação de saldos

`clientes.pontos_saldo` é um **cache** materializado (leitura O(1) no balcão); a
fonte da verdade é `SUM(lotes_pontos.pontos_disponiveis)`. O job compara os dois
lados, aponta os clientes fora de sincronia e, se pedido, reconstrói o cache.

```bash
npm run conciliar                  # relatório (somente leitura)
npm run conciliar -- --corrigir    # reconstrói o saldo a partir dos lotes
npm run conciliar -- --json        # saída em JSON (BI / painel de operação)
npm run conciliar -- --limite=500  # quantos divergentes analisar (padrão 200)
```

Cada divergência é classificada como **saldo inflado** (cache acima dos lotes: a
loja mostra pontos que não existem) ou **defasado** (cache abaixo dos lotes:
existem pontos legítimos que o cliente não vê). A correção roda em transação com
a linha do cliente bloqueada, grava um `AJUSTE` no livro razão e deixa
`SALDO_CONCILIADO` no `audit_log` — nenhuma alteração acontece sem `--corrigir`.

Código de saída, pensado para cron/alerta: `0` tudo em sincronia (ou corrigido),
`1` sobrou divergência, `2` uso incorreto das flags.

```cron
0 3 * * *  cd /opt/promosys && node --env-file=.env src/jobs/expirar-pontos.js >> logs/jobs.log 2>&1
30 3 * * * cd /opt/promosys && node --env-file=.env src/jobs/conciliar-saldos.js >> logs/jobs.log 2>&1
*/5 * * * * cd /opt/promosys && node --env-file=.env src/jobs/enviar-notificacoes.js >> logs/notificacoes.log 2>&1
```

### Notificações ao cliente (outbox → WhatsApp)

Avisar o cliente que ganhou pontos **não** acontece dentro da transação do
crédito: seria uma chamada de rede segurando o lock da linha do cliente, e uma
queda do provedor perderia o aviso. Em vez disso, o crédito grava a **intenção**
do aviso em `notificacoes_outbox` na mesma transação (padrão *transactional
outbox*) e um job, fora da transação, faz o envio com tentativas e backoff.

```bash
npm run notificacoes:enviar                # drena a fila (o cron chama a cada 5 min)
npm run notificacoes:enviar -- --situacao  # retrato da fila por status
npm run notificacoes:enviar -- --simular   # mostra o que sairia, sem gravar nada
```

- Só entra na fila cliente **com telefone válido** e **consentimento `WHATSAPP`
  vigente** (`consentimentos`); a versão do termo aceito fica no `payload`.
- Crédito e **estorno** geram aviso — deixar o estorno em silêncio deixaria o
  cliente com um saldo prometido na mão.
- Falha **5xx/408/429/timeout** reagenda com backoff exponencial (teto de 6h);
  **4xx** cancela na hora (número inválido não melhora insistindo) e tentativas
  esgotadas também cancelam. Cada item carrega tentativas e último erro.
- `WHATSAPP_PROVEDOR=log` registra a mensagem sem sair para a rede (dev);
  `http` faz `POST` JSON no `WHATSAPP_API_URL`. Em produção o boot rejeita
  `log`, para não haver fila "entregue" que nunca chegou ao cliente.
- Canal desligado (`NOTIFICACOES_HABILITADAS=false`, padrão) = nenhum aviso é
  enfileirado; o motor de pontos funciona igual.

Código de saída do job: `0` nada a entregar · `1` sobraram itens recuperáveis
(alerta) · `2` uso incorreto das flags.

### Verificação rápida

```bash
curl http://localhost:3333/health/live
npm test -- --test-reporter=spec
npm run conciliar
npm run build --prefix frontend
```

---

## Árvore de diretórios

```
PromoSys/
├── .editorconfig
├── .env.example                  # todas as variáveis, com defaults de dev
├── .gitignore
├── docker-compose.yml            # MySQL 8 + Adminer para desenvolvimento
├── eslint.config.js
├── package.json
├── README.md
├── docs/
│   └── arquitetura.md            # decisões, invariantes e guia de contribuição
└── src/
    ├── app.js                    # monta a aplicação Fastify (sem listen)
    ├── server.js                 # processo: listen, sinais, shutdown gracioso
    ├── config/
    │   ├── constants.js          # enums do domínio, níveis, paginação
    │   └── env.js                # validação/normalização de process.env (Zod)
    ├── core/                     # infraestrutura transversal (sem regra de negócio)
    │   ├── audit.js              # trilha de auditoria (LGPD/antifraude)
    │   ├── logger.js             # Pino + opções compartilhadas com o Fastify
    │   ├── database/
    │   │   ├── index.js
    │   │   └── pool.js           # Pool MySQL, query/execute, withTransaction
    │   ├── errors/
    │   │   └── app-error.js      # hierarquia de erros + status HTTP
    │   └── http/
    │       ├── error-handler.js  # tratamento global de erros (contrato único)
    │       └── not-found-handler.js
    ├── middlewares/
    │   ├── authenticate.js       # valida JWT e popula request.auth
    │   └── authorize.js          # RBAC por perfil + escopo de unidade
    ├── plugins/                  # plugins Fastify encapsulados (fp)
    │   ├── auth.plugin.js        # @fastify/jwt + decorators authenticate/authorize
    │   ├── database.plugin.js    # app.db, ping no onReady, close no onClose
    │   ├── docs.plugin.js        # Swagger UI em /docs
    │   └── security.plugin.js    # helmet, cors, rate-limit, sensible
    ├── modules/                  # fatia vertical por domínio
    │   ├── auth/                 # login, refresh, logout, me
    │   ├── clientes/             # cadastro, busca por CPF, listagem paginada
    │   ├── pontos/               # regras, crédito, estorno, ajuste, extrato, saldo, conciliação
    │   ├── recompensas/          # catálogo, resgate, entrega
    │   ├── relatorios/           # financeiro, pontos por cliente, desempenho por unidade
    │   ├── notificacoes/         # outbox → WhatsApp (regras, repository, service, cliente do provedor)
    │   └── health/               # /health/live e /health/ready
    │       └── <modulo>/
    │           ├── *.routes.js       # rotas + schemas + RBAC
    │           ├── *.controller.js   # HTTP <-> service (sem regra de negócio)
    │           ├── *.service.js      # regras de negócio e transações
    │           ├── *.repository.js   # SQL parametrizado + mappers
    │           └── *.schema.js       # schemas Zod
    ├── routes/
    │   └── index.js              # agregador (montado sob env.API_PREFIX)
    ├── database/
    │   ├── migrate.js            # runner de migrações (checksum + _migrations)
    │   ├── seed.js               # dados de dev + usuários com hash bcrypt
    │   ├── migrations/001_init.sql
    │   ├── migrations/002_outbox_notificacoes.sql
    │   └── seeds/001_dados_iniciais.sql
    ├── jobs/
    │   ├── expirar-pontos.js     # expiração diária de lotes de pontos
    │   ├── conciliar-saldos.js   # conciliação cache × lotes (relatório/correção)
    │   └── enviar-notificacoes.js # envia a outbox de avisos (backoff + retry)
    └── utils/
        ├── cli.js                # leitura/validação das flags dos jobs
        ├── cpf.js                # validação/normalização de CPF
        ├── date.js               # datas ISO (UTC) para JSON e SQL
        ├── pagination.js         # limit/offset + metadados
        ├── password.js           # bcrypt (hash, verify, tempo constante)
        ├── sql.js                # escape de LIKE, LIMIT/OFFSET
        ├── telefone.js           # normalização E.164
        ├── token.js              # assinatura JWT, refresh opaco, códigos
        └── zod-helpers.js        # booleanos, id, cpf, data (schemas reusáveis)
```

As decisões de arquitetura, as invariantes do domínio, o modelo de concorrência e
o guia para contribuir estão em [`docs/arquitetura.md`](docs/arquitetura.md).

---

## Como rodar no XAMPP

> Este projeto foi pensado para rodar com o MySQL/MariaDB já iniciado no XAMPP, sem Docker.

```bash
# 1) Dependências
npm install

# 2) Variáveis de ambiente
cp .env.example .env
# Ajuste no .env:
#   DB_HOST=127.0.0.1
#   DB_PORT=3306
#   DB_USER=root
#   DB_PASSWORD=
#   DB_NAME=promosysdb
# e gere segredos fortes para JWT_SECRET e JWT_REFRESH_SECRET
# openssl rand -base64 48

# 3) Inicie o MySQL e o Apache no XAMPP
# Lembre-se de ativar o módulo MySQL antes de continuar.

# 4) Cria o banco, aplica schema e dados de exemplo
npm run db:create
npm run migrate
npm run seed

# 5) Subir a API
npm run dev        # http://localhost:3333/api/v1  ·  docs em http://localhost:3333/docs
```

Se o seu XAMPP usa outro usuário/senha, ajuste também os campos `DB_USER`, `DB_PASSWORD` e `DB_NAME` no arquivo `.env` antes de rodar os comandos.

### Frontend

O painel React/Vite fica em `frontend/`. Com a API rodando na porta `3333`:

```bash
npm install --prefix frontend
npm run dev --prefix frontend  # http://127.0.0.1:5173
```

Durante o desenvolvimento, o Vite encaminha `/api` para a API local. Em outra
origem ou ambiente de produção, defina `VITE_API_URL` com o prefixo completo da
API (por exemplo, `https://api.suaempresa.com/api/v1`). Para gerar o bundle:

```bash
npm run build --prefix frontend
```

### Banco de testes no XAMPP

Para os testes locais, use o MySQL/MariaDB já em execução no XAMPP e configure um banco dedicado, por exemplo `promosys_test`.

```bash
cp .env.test.example .env.test
# Ajuste .env.test para a porta e o usuário configurados no XAMPP.
# Exemplo: DB_HOST=127.0.0.1, DB_PORT=3306, DB_USER=root, DB_PASSWORD=

npm run test:db:create
node --env-file=.env.test src/database/migrate.js
npm run test:points
npm run test:conciliacao
```

`npm run test:points` executa o teste de integração de crédito concorrente e
idempotente. `npm run test:conciliacao` cobre as regras puras da conciliação e o
ciclo detectar → corrigir → revalidar. `npm run test:notificacoes` cobre a
outbox de avisos (enfileirar no crédito, enviar, reagendar, desistir) usando um
provedor falso — nenhuma mensagem sai para a internet. Os testes de integração só
rodam com `PROMOSYS_POINT_TESTS=1` (já definido no `.env.test.example`); sem isso,
`npm test` roda apenas o que não depende de banco. Cada teste cria e remove
somente os próprios dados no banco `promosys_test`.

O arquivo `.env.test` é local e ignorado pelo Git. No XAMPP, você pode usar o mesmo
servidor MySQL do desenvolvimento, apenas com um banco separado para testes.

O usuário configurado precisa ter permissão `CREATE DATABASE` para criar o
schema. Em seguida, precisa de permissões para criar tabelas e executar as
operações usadas pela aplicação. O script não remove databases existentes.

Para criar as tabelas manualmente no phpMyAdmin, selecione o database desejado
(por exemplo, `promosysdb`) e importe `src/database/migrations/001_init.sql`.
Essa migração usa `utf8mb4_unicode_ci`, compatível com MySQL e MariaDB.

Credenciais criadas pelo seed (troque em qualquer ambiente compartilhado):

| Perfil | E-mail | Senha | Unidade |
| --- | --- | --- | --- |
| ADMIN | admin@promosys.com.br | `Admin@123` | — |
| GERENTE | gerente@promosys.com.br | `Gerente@123` | LOJA-02 |
| OPERADOR | operador@promosys.com.br | `Oper@123` | LOJA-01 |

### Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | sobe a API com `--watch` (reload automático) |
| `npm start` | sobe a API em modo produção |
| `npm run db:create` | cria o database definido em `.env`, se ainda não existir |
| `npm run migrate` | aplica migrações pendentes |
| `npm run seed` | popula dados de desenvolvimento |
| `npm run test:db:create` | cria o database definido em `.env.test`, se ainda não existir |
| `npm run pontos:expirar` | expira lotes vencidos (agende no cron) |
| `npm run conciliar` | concilia `pontos_saldo` × lotes; `-- --corrigir` reconstrói o cache (agende no cron) |
| `npm run notificacoes:enviar` | envia a outbox de avisos; `-- --situacao` mostra a fila, `-- --simular` não grava nada |
| `npm run lint` / `lint:fix` | ESLint (flat config) |
| `npm test` | `node:test` |
| `npm run test:api` | testes HTTP via `app.inject()` (não exige MySQL) |
| `npm run test:points` | integração do crédito concorrente/idempotente (exige MySQL) |
| `npm run test:conciliacao` | regras puras + conciliação de saldos (exige MySQL) |
| `npm run test:notificacoes` | outbox de avisos ponta a ponta, com provedor falso (exige MySQL) |
| `npm run perf:http` | benchmark HTTP com Autocannon |

### Benchmark HTTP

Com a API em execução, `npm run perf:http` mede `/health/live` por 30 segundos,
com 20 conexões concorrentes. URL, concorrência e duração podem ser ajustadas
por `PERF_URL`, `PERF_CONNECTIONS` e `PERF_DURATION`. O resultado inclui taxa de
requisições, latências percentis, erros e timeouts; compare somente execuções no
mesmo ambiente e sob condições equivalentes.

---

## Endpoints principais

Prefixo padrão: `/api/v1` (configurável em `API_PREFIX`).

| Método | Rota | Perfis | Descrição |
| --- | --- | --- | --- |
| POST | `/auth/login` | público | Login (e-mail **ou** CPF + senha) → access + refresh |
| POST | `/auth/refresh` | público | Rotaciona o refresh token |
| POST | `/auth/logout` | autenticado | Revoga a sessão (ou todas) |
| GET | `/auth/me` | autenticado | Operador autenticado |
| POST | `/clientes` | ADMIN, GERENTE, OPERADOR | Cadastra cliente (valida CPF) |
| GET | `/clientes` | todos | Busca por nome/CPF/telefone com paginação |
| GET | `/clientes/cpf/:cpf` | todos | Consulta rápida no balcão |
| GET | `/clientes/:id` | todos | Detalhe (saldo + nível) |
| PATCH | `/clientes/:id` | ADMIN, GERENTE | Atualiza cadastro |
| DELETE | `/clientes/:id` | ADMIN, GERENTE | Inativa (soft delete) |
| POST | `/pontos/compras` | ADMIN, GERENTE, OPERADOR | Credita pontos (**idempotente por NFC-e/SAT**) |
| POST | `/pontos/estornos` | ADMIN, GERENTE | Estorna crédito |
| POST | `/pontos/ajustes` | ADMIN, GERENTE | Ajuste manual auditado |
| GET | `/pontos/clientes/:clienteId/saldo` | todos | Saldo + pontos a expirar |
| GET | `/pontos/clientes/:clienteId/extrato` | todos | Extrato paginado/filtrável |
| GET | `/recompensas` | todos | Catálogo de prêmios |
| POST | `/recompensas` | ADMIN, GERENTE | Cadastra prêmio |
| PATCH | `/recompensas/:id` | ADMIN, GERENTE | Altera prêmio |
| POST | `/recompensas/:id/resgates` | ADMIN, GERENTE, OPERADOR | Resgata (debita pontos) |
| GET | `/resgates` | todos | Lista resgates |
| POST | `/resgates/:id/confirmar-retirada` | ADMIN, GERENTE, OPERADOR | Entrega no balcão |
| GET | `/health/live` · `/health/ready` | público | Probes de infraestrutura |

Exemplo — crédito de compra no PDV:

```bash
curl -X POST http://localhost:3333/api/v1/pontos/compras \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"clienteId":1,"unidadeId":1,"valor":149.90,"documentoFiscal":"35200112345678901234567890123456789012"}'
```

---

## Contratos da API

**Sucesso**

```json
{ "data": { "...": "..." }, "meta": { "total": 42, "limit": 20, "offset": 0, "page": 1, "pages": 3, "hasNext": true } }
```

**Erro** (qualquer origem: Zod, JWT, MySQL, regra de negócio, bug)

```json
{
  "error": {
    "code": "BUSINESS_RULE_VIOLATION",
    "message": "Saldo de pontos insuficiente para este resgate.",
    "details": { "saldoAtual": 300, "pontosNecessarios": 500 }
  },
  "requestId": "0f1b2c3d-..."
}
```

Códigos estáveis para o front tratar sem parsear texto:
`VALIDATION_ERROR` (422), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` / `RESOURCE_ALREADY_EXISTS` (409), `BUSINESS_RULE_VIOLATION` (422),
`TOO_MANY_REQUESTS` (429), `DATABASE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).

---

## Segurança em destaque

- Segredos JWT validados no boot: em produção o processo **não sobe** com segredo
  fraco, CORS `*` ou Swagger habilitado.
- Senhas com bcrypt; login não distingue "usuário inexistente" de "senha errada"
  (tempo de resposta constante).
- Refresh tokens guardados apenas como SHA-256, com rotação e **detecção de reuso**
  (token revogado reapresentado ⇒ todas as sessões caem).
- Rate limit global + limites específicos em `/auth/login` (5/min) e `/auth/refresh`.
- RBAC por perfil e escopo de unidade (`authorizeUnidade`): o operador só credita na
  própria loja.
- SQL sempre parametrizado (`execute`), `multipleStatements` desligado no pool,
  whitelist de colunas nos updates dinâmicos.
- `audit_log` registra toda operação sensível (quem, o quê, quando, de onde).
- Aviso ao cliente (WhatsApp) só sai com **consentimento LGPD vigente** e o
  telefone aparece mascarado em log/relatório; a credencial do provedor vive só
  em variável de ambiente — nunca em código, resposta HTTP ou log.

## Performance em destaque

- Pool dimensionado (`connectionLimit`, `queueLimit`, `idleTimeout`) com aviso de
  saturação no log; `keepAlive` para não reabrir TCP a cada pico.
- Índices desenhados para os acessos reais: `uk_clientes_cpf`,
  `uk_transacoes_documento` (idempotência), `idx_lotes_fifo`, `idx_resgates_status`.
- Saldo do cliente **materializado** em `clientes.pontos_saldo` (leitura O(1) no
  balcão) com recálculo de nível no mesmo UPDATE.
- Pontos calculados com `DECIMAL` no MySQL (sem erro de ponto flutuante).
- Escritas concorrentes serializadas por `SELECT ... FOR UPDATE` na ordem
  recompensa → cliente (evita deadlock), com transações curtas.
- Listagens sempre paginadas e limitadas a 100 itens.

---

## Próximos passos sugeridos

1. Redis para cache de catálogo e rate limit distribuído (hoje é in-memory, por instância).
2. Webhook de entrada do provedor para status de entrega ("lida" / "falhou no WhatsApp").
3. Relatórios analíticos (BI) lendo o razão `transacoes_pontos`.
4. App do cliente (extrato e resgates) reaproveitando a API existente.
