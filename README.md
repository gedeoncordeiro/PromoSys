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
    │   ├── pontos/               # regras, crédito, estorno, ajuste, extrato, saldo
    │   ├── recompensas/          # catálogo, resgate, entrega
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
    │   └── seeds/001_dados_iniciais.sql
    ├── jobs/
    │   └── expirar-pontos.js     # expiração diária de lotes de pontos
    └── utils/
        ├── cpf.js                # validação/normalização de CPF
        ├── date.js               # datas ISO (UTC) para JSON e SQL
        ├── pagination.js         # limit/offset + metadados
        ├── password.js           # bcrypt (hash, verify, tempo constante)
        ├── sql.js                # escape de LIKE, LIMIT/OFFSET
        ├── telefone.js           # normalização E.164
        ├── token.js              # assinatura JWT, refresh opaco, códigos
        └── zod-helpers.js        # booleanos, id, cpf, data (schemas reusáveis)
```

---

## Como rodar

```bash
# 1) Dependências
npm install

# 2) Banco de dados de desenvolvimento (MySQL 8 + Adminer em :8080)
docker compose up -d

# 3) Variáveis de ambiente (gere segredos reais)
cp .env.example .env
openssl rand -base64 48   # cole em JWT_SECRET e JWT_REFRESH_SECRET

# 4) Schema + dados de exemplo
npm run migrate
npm run seed

# 5) Subir a API
npm run dev        # http://localhost:3333/api/v1  ·  docs em http://localhost:3333/docs
```

### Banco isolado de testes

O MySQL de testes usa o perfil `test`, porta `3307` e volume `mysql-test-data`,
separados do banco de desenvolvimento. Ele não é iniciado pelo `docker compose up`
normal.

```bash
docker compose --profile test up -d mysql-test
cp .env.test.example .env.test
node --env-file=.env.test src/database/migrate.js
npm run test:points
```

`npm run test:points` executa o teste de integração de crédito concorrente e
idempotente. O teste cria e remove apenas os próprios dados no banco `promosys_test`.

Para parar o serviço sem remover os dados do volume:

```bash
docker compose --profile test stop mysql-test
```

O arquivo `.env.test` é local e ignorado pelo Git. As credenciais de exemplo
destinam-se apenas ao container local de testes.

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
| `npm run migrate` | aplica migrações pendentes |
| `npm run seed` | popula dados de desenvolvimento |
| `npm run pontos:expirar` | expira lotes vencidos (agende no cron) |
| `npm run lint` / `lint:fix` | ESLint (flat config) |
| `npm test` | `node:test` |
| `npm run test:api` | testes HTTP via `app.inject()` (não exige MySQL) |
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

1. Testes de integração com `node:test` + `app.inject()` e MySQL efêmero.
2. Redis para cache de catálogo e rate limit distribuído (hoje é in-memory, por instância).
3. Outbox/webhook para notificar o cliente no WhatsApp a cada crédito.
4. Relatórios analíticos (BI) lendo o razão `transacoes_pontos`.
5. Job de conciliação diária: `SUM(lotes_pontos.pontos_disponiveis) == clientes.pontos_saldo`.
