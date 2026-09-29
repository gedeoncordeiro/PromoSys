/**
 * Regras de negócio de autenticação.
 *
 * Fluxo:
 *   login   -> valida credenciais, emite access JWT + refresh opaco (rotativo)
 *   refresh -> rotaciona o refresh token e emite novo access token
 *   logout  -> revoga o refresh token (sessão atual ou todas)
 *   me      -> dados do operador autenticado
 *
 * Segurança:
 *  - mensagens genéricas ("credenciais inválidas") em qualquer falha de login
 *  - tempo de resposta constante quando o usuário não existe
 *  - detecção de reuso de refresh token: revoga todas as sessões do usuário
 */
import { db } from '../../core/database/pool.js';
import * as repositorio from './auth.repository.js';
import { logger } from '../../core/logger.js';
import { env } from '../../config/env.js';
import { UnauthorizedError, NotFoundError } from '../../core/errors/app-error.js';
import { verificarSenha, consumirTempoConstante } from '../../utils/password.js';
import { somenteDigitos } from '../../utils/cpf.js';
import {
  assinarAccessToken,
  gerarRefreshToken,
  hashToken,
  expiracaoRefreshToken,
} from '../../utils/token.js';

/** Normaliza o identificador: e-mail em minúsculas ou CPF só com dígitos. */
function normalizarIdentificador(valor) {
  const texto = String(valor).trim();
  if (texto.includes('@')) return texto.toLowerCase();

  const digitos = somenteDigitos(texto);
  return digitos.length === 11 ? digitos : texto.toLowerCase();
}

/**
 * Autentica o operador e abre uma sessão.
 * @param {{ identificador: string, senha: string, ip?: string, userAgent?: string }} dados
 */
export async function login({ identificador, senha, ip, userAgent }) {
  const usuario = await repositorio.buscarParaLogin(normalizarIdentificador(identificador));

  if (!usuario) {
    // Consome o mesmo tempo de CPU de uma verificação real (anti-enumeração).
    await consumirTempoConstante(senha);
    throw new UnauthorizedError('Credenciais inválidas.');
  }

  if (!usuario.ativo) {
    throw new UnauthorizedError('Usuário inativo. Procure o administrador do programa.');
  }

  const senhaValida = await verificarSenha(senha, usuario.senha_hash);
  if (!senhaValida) {
    logger.warn({ usuarioId: usuario.id, ip }, 'Tentativa de login com senha inválida');
    throw new UnauthorizedError('Credenciais inválidas.');
  }

  const refresh = gerarRefreshToken();

  await db.withTransaction(async (conexao) => {
    await repositorio.inserirRefreshToken(
      {
        usuarioId: usuario.id,
        tokenHash: refresh.hash,
        expiraEm: expiracaoRefreshToken(),
        ip,
        userAgent,
      },
      conexao,
    );

    await repositorio.registrarUltimoLogin(usuario.id, conexao);
  });

  logger.info({ usuarioId: usuario.id, perfil: usuario.perfil, ip }, 'Login efetuado');

  return {
    accessToken: assinarAccessToken({
      usuarioId: usuario.id,
      perfil: usuario.perfil,
      unidadeId: usuario.unidade_id !== null ? Number(usuario.unidade_id) : null,
    }),
    refreshToken: refresh.token,
    tokenType: 'Bearer',
    expiresIn: env.JWT_EXPIRES_IN,
    usuario: repositorio.mapearUsuario(usuario),
  };
}

/**
 * Rotaciona o refresh token e emite um novo access token.
 * Se um token já revogado for reapresentado, assume comprometimento e derruba
 * todas as sessões do usuário.
 */
export async function renovarSessao({ refreshToken, ip, userAgent }) {
  const hashAtual = hashToken(refreshToken);

  return db.withTransaction(async (conexao) => {
    const registro = await repositorio.buscarRefreshPorHash(hashAtual, conexao);

    if (!registro) throw new UnauthorizedError('Sessão inválida. Faça login novamente.');

    if (registro.revogado_em) {
      await repositorio.revogarTodosDoUsuario(registro.usuario_id, conexao);
      logger.warn(
        { usuarioId: Number(registro.usuario_id), ip },
        'Reuso de refresh token detectado — todas as sessões foram revogadas',
      );
      throw new UnauthorizedError('Sessão inválida. Faça login novamente.');
    }

    if (new Date(registro.expira_em).getTime() <= Date.now()) {
      await repositorio.revogarPorHash(hashAtual, conexao);
      throw new UnauthorizedError('Sessão expirada. Faça login novamente.');
    }

    if (!registro.usuario_ativo) {
      await repositorio.revogarPorHash(hashAtual, conexao);
      throw new UnauthorizedError('Usuário inativo.');
    }

    const novoRefresh = gerarRefreshToken();

    await repositorio.rotacionarRefreshToken(
      { id: registro.id, novoHash: novoRefresh.hash, ip, userAgent },
      conexao,
    );

    await repositorio.inserirRefreshToken(
      {
        usuarioId: registro.usuario_id,
        tokenHash: novoRefresh.hash,
        expiraEm: expiracaoRefreshToken(),
        ip,
        userAgent,
      },
      conexao,
    );

    return {
      accessToken: assinarAccessToken({
        usuarioId: Number(registro.usuario_id),
        perfil: registro.usuario_perfil,
        unidadeId:
          registro.usuario_unidade_id !== null ? Number(registro.usuario_unidade_id) : null,
      }),
      refreshToken: novoRefresh.token,
      tokenType: 'Bearer',
      expiresIn: env.JWT_EXPIRES_IN,
    };
  });
}

/** Encerra a sessão atual (revoga o refresh token informado) ou todas as sessões. */
export async function logout({ usuarioId, refreshToken, todasSessoes = false }) {
  if (todasSessoes) {
    const resultado = await repositorio.revogarTodosDoUsuario(usuarioId);
    logger.info({ usuarioId, sessoesRevogadas: resultado.affectedRows }, 'Logout de todas as sessões');
    return { sessoesRevogadas: resultado.affectedRows };
  }

  if (!refreshToken) return { sessoesRevogadas: 0 };

  const resultado = await repositorio.revogarPorHash(hashToken(refreshToken));
  logger.info({ usuarioId, sessoesRevogadas: resultado.affectedRows }, 'Logout efetuado');

  return { sessoesRevogadas: resultado.affectedRows };
}

/** Dados do operador autenticado (fonte da verdade é o banco, não o token). */
export async function obterPerfil(usuarioId) {
  const usuario = await repositorio.buscarPorId(usuarioId);
  if (!usuario) throw new NotFoundError('Usuário não encontrado.');

  return repositorio.mapearUsuario(usuario);
}
