namespace BridgeClient;

/// <summary>
/// Loop de polling de challenges (spec 2.4). Chama /challenges/next; se vier
/// challenge, delega ao BiometricProcessor; senão espera poll_after_ms
/// (valor do SERVIDOR, nunca hardcodado — permite ajuste sem novo release).
/// O claim é atômico no GET do BFF: um challenge retornado já é deste device.
/// Erros de rede/protocolo não matam o loop — loga e continua no próximo
/// ciclo com um backoff fixo curto.
/// </summary>
public sealed class ChallengePoller
{
    private readonly BridgeProtocolClient _client;
    private readonly BiometricProcessor _processor;
    private readonly BridgeLogger _log;

    private const int ErrorBackoffMs = 3000;
    private const int DefaultPollMs = 1500;
    private const int MinWaitAfterProcessMs = 2000;
    private string? _lastLoggedChallengeId;

    public ChallengePoller(BridgeProtocolClient client, BiometricProcessor processor, BridgeLogger log)
    {
        _client = client;
        _processor = processor;
        _log = log;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            int waitMs;
            try
            {
                waitMs = await PollOnceAsync(ct);
            }
            // `when (ct...)`: o TaskCanceledException de TIMEOUT do HttpClient também
            // herda de OperationCanceledException — sem o filtro, um único timeout
            // de rede saía do loop em silêncio e o poller nunca mais voltava
            // (achado no gate de hardware: heartbeat seguia vivo, challenges
            // paravam de ser buscados, sem nenhuma linha de log).
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.Warn($"poll falhou: {ex.GetType().Name} — backoff {ErrorBackoffMs}ms");
                waitMs = ErrorBackoffMs;
            }

            try
            {
                await Task.Delay(waitMs, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>
    /// Uma iteração: busca o próximo challenge, processa se houver, e retorna
    /// quantos ms esperar até a próxima chamada (poll_after_ms do servidor, ou
    /// um default seguro se vier ≤ 0). Público pra ser testável isoladamente.
    /// </summary>
    public async Task<int> PollOnceAsync(CancellationToken ct)
    {
        var envelope = await _client.GetNextChallengeAsync(ct);
        if (envelope.Challenge is not null)
        {
            // O BFF re-serve o mesmo challenge enquanto ele não for concluído
            // (ex: captura de enroll falhou) — loga só na 1ª vez pra não
            // encher o arquivo de log com o mesmo id a cada ciclo.
            if (envelope.Challenge.Id != _lastLoggedChallengeId)
            {
                _lastLoggedChallengeId = envelope.Challenge.Id;
                _log.Info($"challenge recebido {envelope.Challenge.Id} purpose={envelope.Challenge.Purpose}");
            }
            await _processor.ProcessAsync(envelope.Challenge, ct);
            // Piso de 2s depois de processar: sem ele, um challenge cuja captura
            // falha instantaneamente (ex: leitor não aberto) era re-tentado a
            // cada ~1s, martelando SDK e BFF até o challenge expirar.
            return Math.Max(MinWaitAfterProcessMs, envelope.PollAfterMs);
        }
        return envelope.PollAfterMs > 0 ? envelope.PollAfterMs : DefaultPollMs;
    }
}
