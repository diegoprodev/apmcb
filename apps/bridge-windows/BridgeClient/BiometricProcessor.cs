using System.Security.Cryptography;

namespace BridgeClient;

/// <summary>
/// Processa UM challenge de ponta a ponta (spec 2.4/2.6/2.7). Ramifica no
/// purpose: "enroll" vai pra /enrollment; qualquer outro é identify/verify e
/// vai pra /proof. 1:N é loop O(n) VerifyMatch sobre os candidatos
/// decifrados (spec seção 7, decisão de NÃO usar IndexSearch). Isola toda a
/// política de captura/matching/assinatura — o ChallengePoller só decide
/// QUANDO chamar, este decide O QUE fazer com o challenge.
/// </summary>
public sealed class BiometricProcessor
{
    private readonly INitgenAdapter _adapter;
    private readonly Ed25519KeyPair _keyPair;
    private readonly BridgeProtocolClient _client;
    private readonly BridgeConfig _config;
    private readonly BridgeLogger _log;
    private readonly string _deviceId;
    private readonly Func<byte[]?> _tenantKeyProvider;
    private readonly Func<IReadOnlyList<SyncedTemplate>> _candidateProvider;

    /// <summary>Finger index default pra enroll (spec: challenge não carrega; UX real do leitor escolheria). Polegar direito = 1.</summary>
    public int EnrollFingerIndex { get; init; } = 1;

    // ALTO de code review (2026-07-23): Capture/Enroll são chamadas SÍNCRONAS
    // e BLOQUEANTES contra o SDK nativo (até EnrollTimeoutMs=30s), sem
    // CancellationToken — cancelar _cts não as interrompe. Repareamento
    // (TrayApp "Parear leitor…") reabre o MESMO INitgenAdapter/device nativo
    // compartilhado; se isso acontecer enquanto uma captura ainda está presa
    // aqui, duas "sessões" acessam o handle nativo ao mesmo tempo. Este flag
    // deixa TrayApp bloquear o repareamento enquanto um challenge está em
    // voo — não elimina 100% a janela de corrida (o SDK não expõe cancelamento
    // de captura), mas fecha o caminho comum de acionamento manual.
    public volatile bool IsProcessing;

    /// <summary>
    /// Atualiza o cache local de templates AGORA (o orquestrador liga isto ao
    /// TemplateSyncService). Sem isto, um dedo recém-cadastrado só existia no
    /// bridge no próximo sync periódico (5 min) e a identificação logo depois
    /// do cadastro falhava com "nenhum candidato bateu" (achado no gate de
    /// hardware: cadastro 19:24, saídas 19:25-19:27 rejeitadas, cache só
    /// atualizou às 19:28).
    /// </summary>
    public Func<CancellationToken, Task>? RefreshTemplates { get; init; }

    /// <summary>Aviso amigável pro operador no PC do leitor (ex: digital duplicada). Null nos testes.</summary>
    public Action<string, string>? NotifyOperator { get; init; }

    // O BFF re-serve o mesmo challenge enquanto ele não for concluído. Um
    // cadastro cancelado/recusado não tem endpoint de "falha" (só /enrollment
    // com sucesso), então sem esta memória o poller reabria a janela nativa da
    // NITGEN sozinho, mesmo depois de o operador cancelar (achado no teste real).
    private const int FinishedMemory = 256;
    private readonly object _finishedLock = new();
    private readonly HashSet<string> _finished = new();
    private readonly Queue<string> _finishedOrder = new();

    public bool HasFinished(string challengeId)
    {
        lock (_finishedLock) return _finished.Contains(challengeId);
    }

    private void MarkFinished(string challengeId)
    {
        lock (_finishedLock)
        {
            if (!_finished.Add(challengeId)) return;
            _finishedOrder.Enqueue(challengeId);
            while (_finishedOrder.Count > FinishedMemory) _finished.Remove(_finishedOrder.Dequeue());
        }
    }

    private const int MinRefreshIntervalSeconds = 10;
    private DateTime _lastRefreshUtc = DateTime.MinValue;

    public BiometricProcessor(
        INitgenAdapter adapter,
        Ed25519KeyPair keyPair,
        BridgeProtocolClient client,
        BridgeConfig config,
        BridgeLogger log,
        string deviceId,
        Func<byte[]?> tenantKeyProvider,
        Func<IReadOnlyList<SyncedTemplate>> candidateProvider)
    {
        _adapter = adapter;
        _keyPair = keyPair;
        _client = client;
        _config = config;
        _log = log;
        _deviceId = deviceId;
        _tenantKeyProvider = tenantKeyProvider;
        _candidateProvider = candidateProvider;
    }

    public async Task ProcessAsync(Challenge challenge, CancellationToken ct)
    {
        if (HasFinished(challenge.Id)) return;

        IsProcessing = true;
        try
        {
            var done = challenge.Purpose == "enroll"
                ? await ProcessEnrollAsync(challenge, ct)
                : await ProcessIdentifyAsync(challenge, ct);
            if (done) MarkFinished(challenge.Id);
        }
        finally
        {
            IsProcessing = false;
        }
    }

    /// <summary>Retorna true quando o challenge terminou (não deve ser reprocessado).</summary>
    private async Task<bool> ProcessIdentifyAsync(Challenge challenge, CancellationToken ct)
    {
        var capture = _adapter.Capture(_config.CaptureTimeoutMs);
        var now = ProofTimestamp.UtcNowIso();

        if (!capture.Success || capture.FirData is null)
        {
            // Falha de captura (timeout/cancel/fake) — submete failure explícito
            // pra não deixar a UI web esperando (spec 2.4). liveness_passed
            // propaga false só se o SDK reportou dedo falso; senão null.
            await SubmitFailureAsync(challenge, capture.LivenessPassed, capture.ErrorMessage ?? "captura falhou", now, ct);
            return true;
        }

        var tenantKey = _tenantKeyProvider();
        if (tenantKey is null)
        {
            _log.Warn($"challenge {challenge.Id}: sem tenant key em cache — não dá pra decifrar candidatos");
            await SubmitFailureAsync(challenge, capture.LivenessPassed, "tenant key indisponível", now, ct);
            return true;
        }

        // 1:N tenant-wide, ou 1:1 se o challenge fixa expected_user_id.
        var candidates = _candidateProvider();
        if (challenge.ExpectedUserId is { Length: > 0 } expected)
        {
            candidates = candidates.Where(t => t.UserId == expected).ToList();
        }

        var (matchedUserId, matchedFinger) = FindMatch(capture.FirData, candidates, tenantKey);

        // Sem match: o cadastro pode ter sido feito agora (outra estação ou
        // segundos atrás). Sincroniza uma vez (com piso de 10s entre syncs) e
        // tenta de novo antes de recusar.
        if (matchedUserId is null && await RefreshAsync(ct))
        {
            candidates = _candidateProvider();
            if (challenge.ExpectedUserId is { Length: > 0 } expectedAfterRefresh)
            {
                candidates = candidates.Where(t => t.UserId == expectedAfterRefresh).ToList();
            }
            (matchedUserId, matchedFinger) = FindMatch(capture.FirData, candidates, tenantKey);
        }

        if (matchedUserId is null)
        {
            await SubmitFailureAsync(challenge, capture.LivenessPassed, "nenhum candidato bateu", now, ct);
            return true;
        }

        var proof = ProofPayload.Build(
            challenge, _deviceId, matchedUserId,
            matchScore: 1.0, fingerIndex: matchedFinger,
            livenessPassed: capture.LivenessPassed,
            sdkVersion: _adapter.DeviceModel is null ? null : "eNBSP",
            bridgeVersion: BridgeConfig.BridgeVersion, timestampIso: now);
        var signature = ProofPayload.Sign(proof, _keyPair);

        var res = await _client.SubmitProofAsync(challenge.Id, proof, signature, "success", null, ct);
        if (!res.Ok)
        {
            _log.Warn($"challenge {challenge.Id}: /proof success rejeitado {res.StatusCode}");
        }
        else
        {
            _log.Info($"challenge {challenge.Id} ({challenge.Purpose}): identificado com sucesso");
        }
        return true;
    }

    private async Task<bool> ProcessEnrollAsync(Challenge challenge, CancellationToken ct)
    {
        if (challenge.ExpectedUserId is not { Length: > 0 })
        {
            // Enroll sem expected_user_id é rejeitado pelo BFF; nem tenta capturar.
            _log.Warn($"challenge {challenge.Id}: enroll sem expected_user_id — ignorado");
            return true;
        }

        var capture = _adapter.Enroll(_config.EnrollTimeoutMs);
        if (!capture.Success || capture.FirData is null)
        {
            // Enroll não tem caminho de "failure" via endpoint (/enrollment exige
            // template). Loga e deixa o challenge expirar — não pode ir pra /proof
            // (spec 2.4: purpose enroll nunca vai pra /proof).
            _log.Warn($"challenge {challenge.Id}: captura de enroll falhou ({capture.ErrorMessage}) — challenge expira");
            // Cancelou/estourou o tempo: encerra (não reabre a janela). Leitor
            // indisponível: vale tentar de novo quando o watchdog reabrir.
            return !capture.DeviceProblem;
        }

        var tenantKey = _tenantKeyProvider();
        if (tenantKey is null)
        {
            _log.Warn($"challenge {challenge.Id}: sem tenant key — não dá pra cifrar o template do enroll");
            return false;
        }

        // Digital duplicada: cruza com TODOS os templates do tenant (atualiza o
        // cache antes, pra pegar cadastros recentes de outra estação). Cada
        // digital só pode existir uma vez no sistema.
        await RefreshAsync(ct, force: true);
        var (duplicateUserId, duplicateFinger) = FindMatch(capture.FirData, _candidateProvider(), tenantKey);
        if (duplicateUserId is not null)
        {
            var sameUser = duplicateUserId == challenge.ExpectedUserId;
            _log.Warn($"challenge {challenge.Id}: digital duplicada ({(sameUser ? "mesmo usuário" : "outro usuário")}, dedo {duplicateFinger}) — cadastro recusado");
            NotifyOperator?.Invoke(
                "Digital já cadastrada",
                sameUser
                    ? "Este dedo já está cadastrado para este usuário. Escolha outro dedo."
                    : "Esta digital já está cadastrada para outro usuário. Cada pessoa só pode ter as próprias digitais.");
            return true;
        }

        var blob = TemplateCipher.Encrypt(capture.FirData, tenantKey);
        var encryptedBase64 = Convert.ToBase64String(blob);
        var templateHash = "sha256:" + Convert.ToHexString(SHA256.HashData(blob)).ToLowerInvariant();
        var now = ProofTimestamp.UtcNowIso();
        // Dedo escolhido na janela nativa da NITGEN; sem informação do SDK, cai no padrão.
        var enrolledFinger = capture.FingerIndex ?? EnrollFingerIndex;

        var proof = ProofPayload.Build(
            challenge, _deviceId, matchedUserId: challenge.ExpectedUserId,
            matchScore: 1.0, fingerIndex: enrolledFinger,
            livenessPassed: capture.LivenessPassed,
            sdkVersion: _adapter.DeviceModel is null ? null : "eNBSP",
            bridgeVersion: BridgeConfig.BridgeVersion, timestampIso: now);

        // "nitgen-fmd" (não "eNBSP", nome do produto) — DEFAULT_ALLOWED_FORMATS
        // do BFF (apps/bff/src/lib/biometric-enrollment.ts) só aceita este
        // valor; qualquer outro é 400 "format is not supported".
        const string format = "nitgen-fmd";
        var signedPayload = ProofPayload.WithEnrollmentMetadata(proof, templateHash, format, capture.Quality);
        var signature = ProofPayload.Sign(signedPayload, _keyPair);

        var res = await _client.SubmitEnrollmentAsync(
            challenge.Id, proof, encryptedBase64, templateHash, format, capture.Quality, signature, ct);
        if (!res.Ok)
        {
            _log.Warn($"challenge {challenge.Id}: /enrollment rejeitado {res.StatusCode}");
        }
        else
        {
            _log.Info($"challenge {challenge.Id}: enroll gravado (finger {enrolledFinger}, quality {capture.Quality})");
            await RefreshAsync(ct, force: true);
        }
        return true;
    }

    /// <summary>Sincroniza templates agora. Retorna true se chegou a sincronizar (respeita o piso entre syncs, exceto force).</summary>
    private async Task<bool> RefreshAsync(CancellationToken ct, bool force = false)
    {
        if (RefreshTemplates is null) return false;
        if (!force && (DateTime.UtcNow - _lastRefreshUtc).TotalSeconds < MinRefreshIntervalSeconds) return false;
        try
        {
            _lastRefreshUtc = DateTime.UtcNow;
            await RefreshTemplates(ct);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            _log.Warn($"sync imediato falhou: {ex.GetType().Name}");
            return false;
        }
    }

    /// <summary>
    /// Loop O(n) VerifyMatch (spec seção 7). Decifra cada candidato com a
    /// tenant key e compara contra a captura. Retorna o primeiro match. Um
    /// candidato que falha ao decifrar (blob corrompido) é pulado, não aborta
    /// a busca inteira.
    /// </summary>
    private (string? UserId, int? FingerIndex) FindMatch(
        byte[] capturedFir,
        IReadOnlyList<SyncedTemplate> candidates,
        byte[] tenantKey)
    {
        foreach (var candidate in candidates)
        {
            byte[] storedFir;
            try
            {
                var blob = Convert.FromBase64String(candidate.TemplateData);
                storedFir = TemplateCipher.Decrypt(blob, tenantKey);
            }
            catch (Exception ex)
            {
                _log.Warn($"candidato {candidate.UserId}/{candidate.FingerIndex} não decifrou: {ex.GetType().Name}");
                continue;
            }

            if (_adapter.VerifyMatch(capturedFir, storedFir))
            {
                return (candidate.UserId, candidate.FingerIndex);
            }
        }
        return (null, null);
    }

    private async Task SubmitFailureAsync(Challenge challenge, bool? livenessPassed, string reason, string nowIso, CancellationToken ct)
    {
        var proof = ProofPayload.Build(
            challenge, _deviceId, matchedUserId: null,
            matchScore: 0.0, fingerIndex: null, livenessPassed: livenessPassed,
            sdkVersion: _adapter.DeviceModel is null ? null : "eNBSP",
            bridgeVersion: BridgeConfig.BridgeVersion, timestampIso: nowIso);
        var signature = ProofPayload.Sign(proof, _keyPair);
        try
        {
            await _client.SubmitProofAsync(challenge.Id, proof, signature, "failure", reason, ct);
            _log.Info($"challenge {challenge.Id} ({challenge.Purpose}): failure submetido ({reason})");
        }
        catch (Exception ex)
        {
            _log.Warn($"challenge {challenge.Id}: falha ao submeter o próprio failure: {ex.GetType().Name}");
        }
    }
}
