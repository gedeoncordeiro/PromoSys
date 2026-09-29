/**
 * Hash e verificação de senhas (bcrypt).
 * O custo (`BCRYPT_ROUNDS`) é configurável: 10 em dev, 12 em produção.
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/** Gera o hash da senha. Nunca persista a senha em texto puro. */
export function hashSenha(senha) {
  return bcrypt.hash(senha, env.BCRYPT_ROUNDS);
}

/**
 * Compara senha em texto puro com o hash armazenado.
 * Retorna `false` (em vez de lançar) quando não há hash, para simplificar o service.
 */
export async function verificarSenha(senha, hash) {
  if (!hash) return false;
  return bcrypt.compare(senha, hash);
}

/**
 * Consome tempo de CPU equivalente a uma verificação real.
 * Uso: quando o usuário não existe, evita distinguir "usuário inexistente" de
 * "senha errada" por tempo de resposta (timing attack / enumeração de contas).
 */
export async function consumirTempoConstante(senha) {
  await bcrypt.hash(String(senha ?? ''), env.BCRYPT_ROUNDS);
}
