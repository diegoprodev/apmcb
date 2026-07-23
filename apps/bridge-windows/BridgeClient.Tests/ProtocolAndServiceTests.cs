using System.Net;
using System.Text.Json;
using BridgeClient;

namespace BridgeClient.Tests;

[TestFixture]
public class BridgeProtocolClientTests
{
    private static (BridgeProtocolClient client, FakeHttpMessageHandler handler) Make(string reserveId = "reserve-1")
    {
        var handler = new FakeHttpMessageHandler();
        var kp = Ed25519KeyPair.Generate();
        var auth = new DeviceAuthClient("https://bff.test", "dev-1", kp, handler);
        return (new BridgeProtocolClient(auth, reserveId), handler);
    }

    [Test]
    public async Task Heartbeat_envia_POST_assinado_com_os_4_headers()
    {
        var (client, handler) = Make();
        handler.Enqueue(HttpStatusCode.OK, "{}");

        await client.HeartbeatAsync(new HeartbeatRequest("1.0.0", null, null, true, "Mock", null));

        var req = handler.Requests.Single();
        Assert.That(req.Method, Is.EqualTo("POST"));
        Assert.That(req.PathAndQuery, Is.EqualTo("/api/biometric-bridge/heartbeat"));
        Assert.That(req.Headers.Keys, Does.Contain("X-Bridge-Device-Id"));
        Assert.That(req.Headers.Keys, Does.Contain("X-Bridge-Timestamp"));
        Assert.That(req.Headers.Keys, Does.Contain("X-Bridge-Nonce"));
        Assert.That(req.Headers.Keys, Does.Contain("X-Bridge-Signature"));
        Assert.That(req.Headers["X-Bridge-Device-Id"], Is.EqualTo("dev-1"));
    }

    [Test]
    public async Task GetNextChallenge_poem_reserve_id_na_query_e_parseia_envelope()
    {
        var (client, handler) = Make("reserve-xyz");
        handler.Enqueue(HttpStatusCode.OK, "{\"challenge\":null,\"poll_after_ms\":1500}");

        var env = await client.GetNextChallengeAsync();

        Assert.That(handler.Requests.Single().PathAndQuery,
            Is.EqualTo("/api/biometric-bridge/challenges/next?reserve_id=reserve-xyz"));
        Assert.That(env.Challenge, Is.Null);
        Assert.That(env.PollAfterMs, Is.EqualTo(1500));
    }

    [Test]
    public void SyncTemplates_lanca_em_status_de_erro()
    {
        var (client, handler) = Make();
        handler.Enqueue(HttpStatusCode.InternalServerError, "{\"error\":\"boom\"}");
        var ex = Assert.ThrowsAsync<BridgeProtocolException>(() => client.SyncTemplatesAsync(null));
        Assert.That(ex!.StatusCode, Is.EqualTo(500));
    }

    [Test]
    public async Task SubmitProof_serializa_proof_signature_result_no_corpo()
    {
        var (client, handler) = Make();
        handler.Enqueue(HttpStatusCode.OK, "{}");
        var proof = new Dictionary<string, object?> { ["challenge_id"] = "chal-1", ["match_score"] = 1.0 };

        await client.SubmitProofAsync("chal-1", proof, "sig-b64", "success", null);

        var req = handler.Requests.Single();
        Assert.That(req.PathAndQuery, Is.EqualTo("/api/biometric-bridge/challenges/chal-1/proof"));
        using var doc = JsonDocument.Parse(req.Body);
        Assert.That(doc.RootElement.GetProperty("result").GetString(), Is.EqualTo("success"));
        Assert.That(doc.RootElement.GetProperty("bridge_signature").GetString(), Is.EqualTo("sig-b64"));
        Assert.That(doc.RootElement.GetProperty("proof").GetProperty("challenge_id").GetString(), Is.EqualTo("chal-1"));
    }
}

[TestFixture]
public class ChallengePollerTests
{
    private static ChallengePoller MakePoller(FakeHttpMessageHandler handler, MockNitgenAdapter adapter, out BiometricProcessor processor)
    {
        var kp = Ed25519KeyPair.Generate();
        var auth = new DeviceAuthClient("https://bff.test", "dev-1", kp, handler);
        var protocol = new BridgeProtocolClient(auth, "reserve-1");
        var config = BridgeConfig.FromEnvironment();
        var log = new BridgeLogger(Path.Combine(Path.GetTempPath(), $"bridge-test-{Guid.NewGuid():N}.log"));
        processor = new BiometricProcessor(
            adapter, kp, protocol, config, log, "dev-1",
            tenantKeyProvider: () => new byte[32],
            candidateProvider: () => new List<SyncedTemplate>());
        return new ChallengePoller(protocol, processor, log);
    }

    [Test]
    public async Task Sem_challenge_retorna_o_poll_after_ms_do_servidor()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(HttpStatusCode.OK, "{\"challenge\":null,\"poll_after_ms\":2222}");
        var poller = MakePoller(handler, new MockNitgenAdapter(), out _);

        var wait = await poller.PollOnceAsync(CancellationToken.None);
        Assert.That(wait, Is.EqualTo(2222));
    }

    [Test]
    public async Task Sem_challenge_com_poll_after_ms_invalido_usa_default_seguro()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(HttpStatusCode.OK, "{\"challenge\":null,\"poll_after_ms\":0}");
        var poller = MakePoller(handler, new MockNitgenAdapter(), out _);

        var wait = await poller.PollOnceAsync(CancellationToken.None);
        Assert.That(wait, Is.GreaterThan(0));
    }

    [Test]
    public async Task Challenge_identify_dispara_captura_e_submete_proof()
    {
        var handler = new FakeHttpMessageHandler();
        // 1ª resposta: o challenge; 2ª: o POST /proof.
        var challengeJson = BridgeJson.Serialize(new ChallengeEnvelope(TestData.Challenge("identify"), 1500));
        handler.Enqueue(HttpStatusCode.OK, challengeJson);
        handler.Enqueue(HttpStatusCode.OK, "{}");

        var adapter = new MockNitgenAdapter { NextCaptureSucceeds = false }; // sem match → failure
        var poller = MakePoller(handler, adapter, out _);

        await poller.PollOnceAsync(CancellationToken.None);

        // 2 requests: challenges/next + challenges/{id}/proof
        Assert.That(handler.Requests, Has.Count.EqualTo(2));
        Assert.That(handler.Requests[1].PathAndQuery, Does.Contain("/proof"));
    }
}

[TestFixture]
public class HeartbeatServiceTests
{
    [Test]
    public void Payload_reflete_o_estado_do_adapter()
    {
        var handler = new FakeHttpMessageHandler();
        var kp = Ed25519KeyPair.Generate();
        var auth = new DeviceAuthClient("https://bff.test", "dev-1", kp, handler);
        var protocol = new BridgeProtocolClient(auth, "reserve-1");
        var log = new BridgeLogger(Path.Combine(Path.GetTempPath(), $"bridge-test-{Guid.NewGuid():N}.log"));
        var adapter = new MockNitgenAdapter { IsDeviceDetected = true, DeviceModel = "Hamster III" };
        var hb = new HeartbeatService(protocol, adapter, BridgeConfig.FromEnvironment(), log);

        var payload = hb.BuildPayload(lastErrorCode: "E123");

        Assert.That(payload.DeviceDetected, Is.True);
        Assert.That(payload.DeviceModel, Is.EqualTo("Hamster III"));
        Assert.That(payload.LastErrorCode, Is.EqualTo("E123"));
        Assert.That(payload.BridgeVersion, Is.Not.Null.And.Not.Empty);
    }

    // MÉDIO de code review (2026-07-23): sem esta distinção, um device
    // revogado (401/403 — ex: PC roubado, revogado pelo admin) ficava
    // indistinguível de uma falha de rede transitória, e o ícone da bandeja
    // nunca mudava de verde — escondendo exatamente o sinal que a revogação
    // deveria expor pro operador local.
    [Test]
    public async Task Heartbeat_401_marca_LastStatus_como_AuthRejected_nao_NetworkError()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(HttpStatusCode.Unauthorized, "{\"error\":\"device revoked\"}");
        var kp = Ed25519KeyPair.Generate();
        var auth = new DeviceAuthClient("https://bff.test", "dev-1", kp, handler);
        var protocol = new BridgeProtocolClient(auth, "reserve-1");
        var log = new BridgeLogger(Path.Combine(Path.GetTempPath(), $"bridge-test-{Guid.NewGuid():N}.log"));
        var adapter = new MockNitgenAdapter();
        var hb = new HeartbeatService(protocol, adapter, BridgeConfig.FromEnvironment(), log);

        await hb.SendOnceAsync(null, CancellationToken.None);

        Assert.That(hb.LastHeartbeatOk, Is.False);
        Assert.That(hb.LastStatus, Is.EqualTo(HeartbeatStatus.AuthRejected));
    }

    [Test]
    public async Task Heartbeat_erro_de_rede_marca_LastStatus_como_NetworkError_nao_AuthRejected()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(HttpStatusCode.ServiceUnavailable, "{}");
        var kp = Ed25519KeyPair.Generate();
        var auth = new DeviceAuthClient("https://bff.test", "dev-1", kp, handler);
        var protocol = new BridgeProtocolClient(auth, "reserve-1");
        var log = new BridgeLogger(Path.Combine(Path.GetTempPath(), $"bridge-test-{Guid.NewGuid():N}.log"));
        var adapter = new MockNitgenAdapter();
        var hb = new HeartbeatService(protocol, adapter, BridgeConfig.FromEnvironment(), log);

        await hb.SendOnceAsync(null, CancellationToken.None);

        Assert.That(hb.LastStatus, Is.EqualTo(HeartbeatStatus.NetworkError));
    }
}
