-- ============================================================================
-- PromoSys · Migração 001 · Schema inicial
-- ============================================================================
-- Convenções:
--   * Tudo em UTC (TIMESTAMP/DATETIME). A API converte para o fuso local.
--   * utf8mb4 (acentuação + emojis em descrições de campanha).
--   * CPF sempre com 11 dígitos (CHAR(11)), sem máscara.
--   * Telefone em E.164 (VARCHAR(20)).
--   * Valores monetários em DECIMAL (nunca FLOAT).
--   * Pontos em INT (saldo do cliente e movimentos).
--   * FKs com ON DELETE RESTRICT por padrão: histórico de fidelidade é imutável.
-- ============================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- unidades: lojas físicas (PDV)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unidades (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo        VARCHAR(20)     NOT NULL COMMENT 'Código curto usado pelo PDV',
  nome          VARCHAR(120)    NOT NULL,
  cnpj          CHAR(14)        NULL,
  cidade        VARCHAR(80)     NULL,
  uf            CHAR(2)         NULL,
  ativo         TINYINT(1)      NOT NULL DEFAULT 1,
  criado_em     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_unidades_codigo (codigo),
  UNIQUE KEY uk_unidades_cnpj (cnpj),
  KEY idx_unidades_ativo (ativo)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- usuarios: operadores da API (PDV, gerência, auditoria)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome            VARCHAR(120)    NOT NULL,
  email           VARCHAR(160)    NOT NULL,
  cpf             CHAR(11)        NULL,
  senha_hash      VARCHAR(120)    NOT NULL COMMENT 'bcrypt',
  perfil          ENUM('ADMIN','GERENTE','OPERADOR','AUDITOR') NOT NULL DEFAULT 'OPERADOR',
  unidade_id      BIGINT UNSIGNED NULL COMMENT 'Loja do operador (NULL para perfis globais)',
  ativo           TINYINT(1)      NOT NULL DEFAULT 1,
  ultimo_login_em DATETIME(3)     NULL,
  criado_em       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuarios_email (email),
  UNIQUE KEY uk_usuarios_cpf (cpf),
  KEY idx_usuarios_unidade (unidade_id),
  CONSTRAINT fk_usuarios_unidade FOREIGN KEY (unidade_id) REFERENCES unidades (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- refresh_tokens: sessões de longa duração (rotativas)
-- Guarda apenas o SHA-256 do token, nunca o valor em claro.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id           BIGINT UNSIGNED NOT NULL,
  token_hash           CHAR(64)        NOT NULL,
  expira_em            DATETIME        NOT NULL,
  revogado_em          DATETIME        NULL,
  substituido_por_hash CHAR(64)        NULL COMMENT 'Rotação: aponta para o token novo',
  ip                   VARCHAR(45)     NULL,
  user_agent           VARCHAR(255)    NULL,
  criado_em            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_refresh_token_hash (token_hash),
  KEY idx_refresh_usuario_ativo (usuario_id, revogado_em),
  KEY idx_refresh_expiracao (expira_em),
  CONSTRAINT fk_refresh_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- clientes: participantes do programa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cpf                  CHAR(11)        NOT NULL,
  nome                 VARCHAR(160)    NOT NULL,
  email                VARCHAR(160)    NULL,
  telefone             VARCHAR(20)     NULL COMMENT 'E.164 (+55...)',
  data_nascimento      DATE            NULL,
  cidade               VARCHAR(80)     NULL,
  uf                   CHAR(2)         NULL,
  pontos_saldo         INT             NOT NULL DEFAULT 0 COMMENT 'Cache materializado de SUM(lotes_pontos.pontos_disponiveis)',
  nivel                ENUM('BRONZE','PRATA','OURO','DIAMANTE') NOT NULL DEFAULT 'BRONZE',
  aceita_marketing     TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Consentimento LGPD (detalhado em consentimentos)',
  ativo                TINYINT(1)      NOT NULL DEFAULT 1,
  unidade_cadastro_id  BIGINT UNSIGNED NULL,
  ultima_visita_em     DATETIME(3)     NULL,
  criado_em            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_clientes_cpf (cpf),
  KEY idx_clientes_telefone (telefone),
  KEY idx_clientes_nome (nome),
  KEY idx_clientes_ativo_nivel (ativo, nivel),
  CONSTRAINT chk_clientes_saldo_nao_negativo CHECK (pontos_saldo >= 0),
  CONSTRAINT fk_clientes_unidade FOREIGN KEY (unidade_cadastro_id) REFERENCES unidades (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- consentimentos: trilha LGPD (histórico de aceites por finalidade)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consentimentos (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id BIGINT UNSIGNED NOT NULL,
  finalidade ENUM('MARKETING','WHATSAPP','COMPARTILHAMENTO_TERCEIROS') NOT NULL,
  versao     VARCHAR(20)     NOT NULL COMMENT 'Versão do termo aceito',
  aceito     TINYINT(1)      NOT NULL,
  ip         VARCHAR(45)     NULL,
  criado_em  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_consentimentos_cliente (cliente_id, finalidade, criado_em),
  CONSTRAINT fk_consentimentos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- regras_pontuacao: quantos pontos por real, validade e mínimo de compra
-- unidade_id NULL = regra global (fallback para lojas sem regra própria)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regras_pontuacao (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  unidade_id          BIGINT UNSIGNED NULL,
  nome                VARCHAR(120)    NOT NULL,
  pontos_por_real     DECIMAL(6,3)    NOT NULL DEFAULT 1.000,
  valor_minimo_compra DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
  validade_pontos_dias SMALLINT UNSIGNED NOT NULL DEFAULT 365,
  prioridade          TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Maior vence entre regras vigentes',
  vigencia_inicio     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vigencia_fim        DATETIME        NULL,
  ativo               TINYINT(1)      NOT NULL DEFAULT 1,
  criado_em           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_regras_busca (ativo, unidade_id, prioridade),
  CONSTRAINT fk_regras_unidade FOREIGN KEY (unidade_id) REFERENCES unidades (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_regras_pontos_positivos CHECK (pontos_por_real > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- recompensas: catálogo de prêmios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recompensas (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sku                VARCHAR(40)     NOT NULL,
  nome               VARCHAR(160)    NOT NULL,
  descricao          VARCHAR(500)    NULL,
  tipo               ENUM('PRODUTO','DESCONTO','SERVICO','VOUCHER') NOT NULL DEFAULT 'PRODUTO',
  pontos_custo       INT UNSIGNED    NOT NULL,
  valor_referencia   DECIMAL(10,2)   NULL,
  estoque            INT             NULL COMMENT 'NULL = ilimitado',
  limite_por_cliente INT             NULL COMMENT 'NULL = sem limite',
  vigencia_inicio    DATETIME        NULL,
  vigencia_fim       DATETIME        NULL,
  imagem_url         VARCHAR(500)    NULL,
  ativo              TINYINT(1)      NOT NULL DEFAULT 1,
  criado_em          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_recompensas_sku (sku),
  KEY idx_recompensas_catalogo (ativo, pontos_custo),
  CONSTRAINT chk_recompensas_custo_positivo CHECK (pontos_custo > 0),
  CONSTRAINT chk_recompensas_estoque_nao_negativo CHECK (estoque IS NULL OR estoque >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- transacoes_pontos: LIVRO RAZÃO (append-only) de todas as movimentações
--   uk_transacoes_documento -> idempotência do crédito por NFC-e/SAT
--   uk_transacoes_estorno   -> impede estorno duplicado da mesma transação
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transacoes_pontos (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id              BIGINT UNSIGNED NOT NULL,
  unidade_id              BIGINT UNSIGNED NULL,
  usuario_id              BIGINT UNSIGNED NULL,
  tipo                    ENUM('CREDITO','DEBITO','EXPIRACAO','ESTORNO','AJUSTE') NOT NULL,
  origem                  ENUM('COMPRA','BONUS','INDICACAO','RESGATE','EXPIRACAO','ESTORNO','AJUSTE_MANUAL') NOT NULL,
  pontos                  INT UNSIGNED    NOT NULL COMMENT 'Sempre positivo; o tipo define a direção',
  valor_compra            DECIMAL(12,2)   NULL,
  documento_fiscal        VARCHAR(44)     NULL COMMENT 'NFC-e / SAT',
  descricao               VARCHAR(255)    NULL,
  saldo_apos              INT             NULL COMMENT 'Saldo do cliente após o movimento',
  estorno_de_transacao_id BIGINT UNSIGNED NULL,
  criado_em               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_transacoes_documento (unidade_id, documento_fiscal, origem),
  UNIQUE KEY uk_transacoes_estorno (estorno_de_transacao_id),
  KEY idx_transacoes_cliente_data (cliente_id, criado_em),
  KEY idx_transacoes_data (criado_em),
  KEY idx_transacoes_unidade_data (unidade_id, criado_em),
  CONSTRAINT fk_transacoes_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_transacoes_unidade FOREIGN KEY (unidade_id) REFERENCES unidades (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_transacoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_transacoes_estorno FOREIGN KEY (estorno_de_transacao_id) REFERENCES transacoes_pontos (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- lotes_pontos: validade dos pontos (consumo FIFO pelo que vence primeiro)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lotes_pontos (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id          BIGINT UNSIGNED NOT NULL,
  transacao_id        BIGINT UNSIGNED NULL COMMENT 'Crédito que originou o lote',
  pontos_lote         INT UNSIGNED    NOT NULL,
  pontos_disponiveis  INT UNSIGNED    NOT NULL,
  expira_em           DATE            NOT NULL,
  criado_em           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lotes_fifo (cliente_id, pontos_disponiveis, expira_em),
  KEY idx_lotes_expira (pontos_disponiveis, expira_em),
  CONSTRAINT chk_lotes_disponiveis CHECK (pontos_disponiveis <= pontos_lote),
  CONSTRAINT fk_lotes_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_lotes_transacao FOREIGN KEY (transacao_id) REFERENCES transacoes_pontos (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- resgates: comprovantes de resgate (código apresentado no balcão)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resgates (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo           VARCHAR(20)     NOT NULL,
  cliente_id       BIGINT UNSIGNED NOT NULL,
  recompensa_id    BIGINT UNSIGNED NOT NULL,
  unidade_id       BIGINT UNSIGNED NULL,
  usuario_id       BIGINT UNSIGNED NULL,
  transacao_id     BIGINT UNSIGNED NULL COMMENT 'Débito correspondente no razão',
  pontos_debitados INT UNSIGNED    NOT NULL,
  saldo_apos       INT             NULL,
  status           ENUM('PENDENTE','ENTREGUE','CANCELADO','EXPIRADO') NOT NULL DEFAULT 'PENDENTE',
  retirado_em      DATETIME(3)     NULL,
  criado_em        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_resgates_codigo (codigo),
  KEY idx_resgates_cliente (cliente_id, criado_em),
  KEY idx_resgates_status (status, criado_em),
  KEY idx_resgates_recompensa_cliente (recompensa_id, cliente_id),
  CONSTRAINT fk_resgates_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_resgates_recompensa FOREIGN KEY (recompensa_id) REFERENCES recompensas (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_resgates_unidade FOREIGN KEY (unidade_id) REFERENCES unidades (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_resgates_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_resgates_transacao FOREIGN KEY (transacao_id) REFERENCES transacoes_pontos (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- audit_log: trilha de auditoria (quem fez o quê, quando e de onde)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id       BIGINT UNSIGNED NULL,
  unidade_id       BIGINT UNSIGNED NULL,
  acao             VARCHAR(60)     NOT NULL COMMENT 'CLIENTE_CRIADO, PONTOS_CREDITADOS, ...',
  entidade         VARCHAR(60)     NOT NULL,
  entidade_id      VARCHAR(64)     NULL,
  dados_anteriores JSON            NULL,
  dados_novos      JSON            NULL,
  ip               VARCHAR(45)     NULL,
  user_agent       VARCHAR(255)    NULL,
  criado_em        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_entidade (entidade, entidade_id, criado_em),
  KEY idx_audit_usuario (usuario_id, criado_em),
  KEY idx_audit_acao (acao, criado_em)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
