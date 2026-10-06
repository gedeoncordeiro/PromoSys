-- ============================================================================
-- PromoSys · Migração 002 · Outbox transacional de notificações
-- ============================================================================
-- Problema que esta tabela resolve:
--   avisar o cliente no WhatsApp a cada crédito NÃO pode ser feito dentro da
--   transação que credita pontos. Chamar um provedor externo (HTTP) ali dentro
--   significaria: (a) segurar o lock da linha do cliente durante uma chamada de
--   rede; (b) perder o aviso se o provedor cair; (c) duplicar o aviso quando o
--   PDV reenvia a mesma NFC-e.
--
-- Padrão "transactional outbox":
--   a intenção de notificar é gravada na MESMA transação que cria o crédito
--   (commit atômico: ou existem os dois, ou nenhum). O envio é feito depois, por
--   um job fora da transação, com tentativas, backoff e trilha de erro.
--
-- Convenções: UTC, utf8mb4, telefone em E.164, sem segredo/token nesta tabela.
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS notificacoes_outbox (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id           BIGINT UNSIGNED NOT NULL,
  transacao_id         BIGINT UNSIGNED NULL COMMENT 'Movimento do razão que originou o aviso',
  tipo                 ENUM('PONTOS_CREDITADOS','PONTOS_ESTORNADOS','RESGATE_CONFIRMADO') NOT NULL,
  canal                ENUM('WHATSAPP') NOT NULL DEFAULT 'WHATSAPP',
  destino              VARCHAR(20)     NOT NULL COMMENT 'Telefone E.164 congelado no enfileiramento',
  payload              JSON            NOT NULL COMMENT 'Dados da mensagem (renderizada no envio)',
  status               ENUM('PENDENTE','FALHA','ENVIADA','CANCELADA') NOT NULL DEFAULT 'PENDENTE'
                       COMMENT 'FALHA = tentou e vai tentar de novo; CANCELADA = desistiu (erro definitivo ou tentativas esgotadas)',
  tentativas           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  proxima_tentativa_em DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                       COMMENT 'Também serve de lease: o worker empurra esta data ao reivindicar',
  ultimo_erro          VARCHAR(500)    NULL COMMENT 'Mensagem do provedor, truncada (sem credencial)',
  enviada_em           DATETIME        NULL,
  criado_em            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Um aviso por movimento, por tipo e canal: reenviar a NFC-e não duplica o aviso.
  UNIQUE KEY uk_outbox_transacao (transacao_id, tipo, canal),
  -- Índice do worker: "quem já pode ser tentado de novo".
  KEY idx_outbox_fila (status, proxima_tentativa_em, id),
  KEY idx_outbox_cliente (cliente_id, criado_em),
  CONSTRAINT fk_outbox_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_outbox_transacao FOREIGN KEY (transacao_id) REFERENCES transacoes_pontos (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
