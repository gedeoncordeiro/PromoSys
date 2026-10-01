import autocannon from 'autocannon';

function inteiroPositivo(nome, valorPadrao) {
  const valor = Number(process.env[nome] ?? valorPadrao);
  if (!Number.isSafeInteger(valor) || valor < 1) {
    throw new Error(`${nome} precisa ser um inteiro positivo.`);
  }
  return valor;
}

const url = process.env.PERF_URL ?? 'http://127.0.0.1:3333/api/v1/health/live';
const conexoes = inteiroPositivo('PERF_CONNECTIONS', 20);
const duracao = inteiroPositivo('PERF_DURATION', 30);

if (!['http:', 'https:'].includes(new URL(url).protocol)) {
  throw new Error('PERF_URL precisa usar HTTP ou HTTPS.');
}

const resultado = await new Promise((resolve, reject) => {
  autocannon({ url, connections: conexoes, duration: duracao, pipelining: 1 }, (erro, dados) => {
    if (erro) reject(erro);
    else resolve(dados);
  });
});

process.stdout.write(
  `${JSON.stringify(
    {
      url,
      duracaoSegundos: duracao,
      conexoes,
      requisicoesPorSegundo: resultado.requests.average,
      latenciaMs: {
        media: resultado.latency.average,
        p50: resultado.latency.p50,
        p90: resultado.latency.p90,
        p97_5: resultado.latency.p97_5,
        p99: resultado.latency.p99,
      },
      bytesPorSegundo: resultado.throughput.average,
      erros: resultado.errors,
      timeouts: resultado.timeouts,
      respostasNao2xx: resultado.non2xx,
    },
    null,
    2,
  )}\n`,
);

if (resultado.errors > 0 || resultado.timeouts > 0 || resultado.non2xx > 0) {
  process.exitCode = 1;
}