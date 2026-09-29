-- ============================================================================
-- PromoSys · Seeds · dados mínimos para desenvolvimento
-- ============================================================================
-- Aplicado por `npm run seed` (idempotente: usa ON DUPLICATE KEY UPDATE).
-- Os usuários são criados por seed.js para gerar o hash bcrypt em runtime.
-- ============================================================================

-- Unidades -------------------------------------------------------------------
INSERT INTO unidades (codigo, nome, cnpj, cidade, uf)
VALUES
  ('LOJA-01', 'Loja Centro', '11222333000181', 'São Paulo', 'SP'),
  ('LOJA-02', 'Loja Shopping', '11222333000262', 'Campinas', 'SP')
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome),
  cidade = VALUES(cidade),
  uf = VALUES(uf);

-- Regras de pontuação --------------------------------------------------------
-- Regra global: 1 ponto por real, 12 meses de validade, sem compra mínima.
INSERT INTO regras_pontuacao
  (unidade_id, nome, pontos_por_real, valor_minimo_compra, validade_pontos_dias, prioridade)
SELECT NULL, 'Regra global (1 ponto por R$ 1,00)', 1.000, 0.00, 365, 0
WHERE NOT EXISTS (SELECT 1 FROM regras_pontuacao WHERE unidade_id IS NULL AND ativo = 1);

-- Regra promocional da Loja Centro: dobro de pontos e validade mais curta.
INSERT INTO regras_pontuacao
  (unidade_id, nome, pontos_por_real, valor_minimo_compra, validade_pontos_dias, prioridade)
SELECT u.id, 'Campanha Loja Centro (2 pontos por R$ 1,00)', 2.000, 50.00, 180, 10
FROM unidades u
WHERE u.codigo = 'LOJA-01'
  AND NOT EXISTS (
    SELECT 1 FROM regras_pontuacao r WHERE r.unidade_id = u.id AND r.ativo = 1
  );

-- Catálogo de recompensas ----------------------------------------------------
INSERT INTO recompensas
  (sku, nome, descricao, tipo, pontos_custo, valor_referencia, estoque, limite_por_cliente)
VALUES
  ('RC-CANECA-01', 'Caneca PromoSys', 'Caneca de cerâmica 350ml', 'PRODUTO', 500, 29.90, 200, NULL),
  ('RC-DESC-10', 'Vale-desconto R$ 10', 'Desconto de R$ 10 na próxima compra', 'DESCONTO', 1000, 10.00, NULL, 2),
  ('RC-DESC-50', 'Vale-desconto R$ 50', 'Desconto de R$ 50 na próxima compra', 'DESCONTO', 4500, 50.00, NULL, 1)
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome),
  pontos_custo = VALUES(pontos_custo),
  estoque = VALUES(estoque),
  limite_por_cliente = VALUES(limite_por_cliente);
