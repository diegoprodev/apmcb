using System.Net;
using System.Text;
using System.Text.Json;
using BridgeClient;

namespace BridgeClient.Tests;

[TestFixture]
public class TemplateStoreMergeTests
{
    [Test]
    public void Merge_faz_upsert_por_user_e_finger_e_avanca_o_cursor()
    {
        var initial = new TemplateStoreState(null, new List<SyncedTemplate>
        {
            TestData.Template("user-1", 1, "AAA"),
        });

        var page = new List<SyncedTemplate>
        {
            TestData.Template("user-1", 1, "BBB"), // atualiza o mesmo (user,finger)
            TestData.Template("user-2", 3, "CCC"), // novo
        };

        var merged = TemplateStore.Merge(initial, page, nextCursor: "cursor-2");

        Assert.That(merged.Cursor, Is.EqualTo("cursor-2"));
        Assert.That(merged.Templates, Has.Count.EqualTo(2));
        var updated = merged.Templates.Single(t => t.UserId == "user-1" && t.FingerIndex == 1);
        Assert.That(updated.TemplateData, Is.EqualTo("BBB"), "template atualizado substitui o anterior");
    }
}

[TestFixture]
public class TemplateSyncServiceTests
{
    [Test]
    public async Task Sync_pagina_ate_next_cursor_null_e_acumula_todos()
    {
        var handler = new FakeHttpMessageHandler();
        // Página 1 (cursor null → "c1"), página 2 ("c1" → null).
        handler.Enqueue(HttpStatusCode.OK, BridgeJson.Serialize(new TemplateSyncResponse(
            new[] { TestData.Template("u1", 1, "A") }, "c1")));
        handler.Enqueue(HttpStatusCode.OK, BridgeJson.Serialize(new TemplateSyncResponse(
            new[] { TestData.Template("u2", 1, "B") }, null)));

        var kp = Ed25519KeyPair.Generate();
        var auth = new DeviceAuthClient("https://bff.test", "dev-1", kp, handler);
        var protocol = new BridgeProtocolClient(auth, "reserve-1");
        var store = new TemplateStore(Path.Combine(Path.GetTempPath(), $"tmpl-{Guid.NewGuid():N}.dat"));
        var log = new BridgeLogger(Path.Combine(Path.GetTempPath(), $"bridge-test-{Guid.NewGuid():N}.log"));
        var sync = new TemplateSyncService(protocol, store, log);

        var total = await sync.SyncAsync();

        Assert.That(total, Is.EqualTo(2));
        Assert.That(handler.Requests, Has.Count.EqualTo(2));
        // A 2ª chamada reenvia o cursor opaco recebido na 1ª.
        Assert.That(handler.Requests[1].PathAndQuery, Does.Contain("since=c1"));
        Assert.That(sync.Current.Cursor, Is.Null, "cursor final é null quando esgota");
    }
}

[TestFixture]
public class PairingServiceTests
{
    [Test]
    public async Task Pareamento_bem_sucedido_persiste_device_reserve_e_chave()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(HttpStatusCode.Created, BridgeJson.Serialize(
            new PairResponse("device-9", "tenant-9", "reserve-9")));

        var dir = Path.Combine(Path.GetTempPath(), $"ks-{Guid.NewGuid():N}");
        var keyStore = new KeyStore(dir);
        var log = new BridgeLogger(Path.Combine(dir, "log.txt"));
        var svc = new PairingService("https://bff.test", keyStore, log, handler);

        var result = await svc.PairAsync("APMCB-1234-5678");

        Assert.That(result.Success, Is.True);
        Assert.That(result.DeviceId, Is.EqualTo("device-9"));
        Assert.That(result.ReserveId, Is.EqualTo("reserve-9"));
        Assert.That(keyStore.HasPairedDevice, Is.True);

        var loaded = keyStore.LoadPairedDevice();
        Assert.That(loaded, Is.Not.Null);
        Assert.That(loaded!.Value.DeviceId, Is.EqualTo("device-9"));
        Assert.That(loaded.Value.ReserveId, Is.EqualTo("reserve-9"));

        // O corpo do /pair NÃO envia device_name (spec 2.2) mas envia a pública PEM.
        using var doc = JsonDocument.Parse(handler.Requests.Single().Body);
        Assert.That(doc.RootElement.TryGetProperty("device_name", out _), Is.False);
        Assert.That(doc.RootElement.GetProperty("public_key").GetString(), Does.Contain("BEGIN PUBLIC KEY"));

        try { Directory.Delete(dir, true); } catch { /* cleanup best-effort */ }
    }

    [Test]
    public async Task Pareamento_falho_nao_deixa_chave_orfa_no_disco()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(HttpStatusCode.Gone, "{\"error\":\"expired\"}"); // 410

        var dir = Path.Combine(Path.GetTempPath(), $"ks-{Guid.NewGuid():N}");
        var keyStore = new KeyStore(dir);
        var log = new BridgeLogger(Path.Combine(dir, "log.txt"));
        var svc = new PairingService("https://bff.test", keyStore, log, handler);

        var result = await svc.PairAsync("APMCB-0000-0000");

        Assert.That(result.Success, Is.False);
        Assert.That(result.StatusCode, Is.EqualTo(410));
        Assert.That(keyStore.HasPairedDevice, Is.False, "nada persistido em pareamento falho");

        try { Directory.Delete(dir, true); } catch { /* cleanup best-effort */ }
    }
}

[TestFixture]
public class BiometricProcessorTests
{
    private static (BiometricProcessor proc, FakeHttpMessageHandler handler, byte[] tenantKey) Make(
        MockNitgenAdapter adapter, IReadOnlyList<SyncedTemplate> candidates, int enrollFinger = 1)
    {
        var handler = new FakeHttpMessageHandler();
        var kp = Ed25519KeyPair.Generate();
        var auth = new DeviceAuthClient("https://bff.test", "dev-1", kp, handler);
        var protocol = new BridgeProtocolClient(auth, "reserve-1");
        var log = new BridgeLogger(Path.Combine(Path.GetTempPath(), $"bridge-test-{Guid.NewGuid():N}.log"));
        var tenantKey = new byte[32];
        var proc = new BiometricProcessor(
            adapter, kp, protocol, BridgeConfig.FromEnvironment(), log, "dev-1",
            tenantKeyProvider: () => tenantKey,
            candidateProvider: () => candidates)
        {
            EnrollFingerIndex = enrollFinger,
        };
        return (proc, handler, tenantKey);
    }

    [Test]
    public async Task Identify_com_match_submete_proof_success_com_matched_user()
    {
        // Candidato cujo FIR decifrado == o que o mock "captura".
        var key = new byte[32];
        var storedFir = Encoding.UTF8.GetBytes("mock-fir:finger-1"); // igual ao mock (NextCaptureLabel=finger-1)
        var blob = TemplateCipher.Encrypt(storedFir, key);
        var candidate = TestData.Template("user-7", 4, Convert.ToBase64String(blob));

        var adapter = new MockNitgenAdapter { NextCaptureLabel = "finger-1", NextLivenessPassed = true };
        var (proc, handler, _) = Make(adapter, new[] { candidate });
        handler.Enqueue(HttpStatusCode.OK, "{}"); // /proof

        await proc.ProcessAsync(TestData.Challenge("identify"), CancellationToken.None);

        var req = handler.Requests.Single();
        Assert.That(req.PathAndQuery, Does.Contain("/proof"));
        using var doc = JsonDocument.Parse(req.Body);
        Assert.That(doc.RootElement.GetProperty("result").GetString(), Is.EqualTo("success"));
        Assert.That(doc.RootElement.GetProperty("proof").GetProperty("matched_user_id").GetString(), Is.EqualTo("user-7"));
        Assert.That(doc.RootElement.GetProperty("proof").GetProperty("finger_index").GetInt32(), Is.EqualTo(4));
        Assert.That(doc.RootElement.GetProperty("proof").GetProperty("liveness_passed").GetBoolean(), Is.True);
        // CRÍTICO de code review (2026-07-23): mesma checagem de timestamp do
        // teste de enroll abaixo, mas no caminho de identify (site de geração
        // de timestamp separado em BiometricProcessor — os dois precisam ser
        // travados independentemente).
        Assert.That(doc.RootElement.GetProperty("proof").GetProperty("timestamp").GetString(), Does.EndWith("Z"));
    }

    [Test]
    public async Task Identify_sem_match_submete_failure()
    {
        var key = new byte[32];
        var blob = TemplateCipher.Encrypt(Encoding.UTF8.GetBytes("mock-fir:OUTRO"), key);
        var candidate = TestData.Template("user-7", 1, Convert.ToBase64String(blob));

        var adapter = new MockNitgenAdapter { NextCaptureLabel = "finger-1" }; // não bate com "OUTRO"
        var (proc, handler, _) = Make(adapter, new[] { candidate });
        handler.Enqueue(HttpStatusCode.OK, "{}");

        await proc.ProcessAsync(TestData.Challenge("identify"), CancellationToken.None);

        using var doc = JsonDocument.Parse(handler.Requests.Single().Body);
        Assert.That(doc.RootElement.GetProperty("result").GetString(), Is.EqualTo("failure"));
        Assert.That(doc.RootElement.GetProperty("proof").GetProperty("matched_user_id").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Captura_reprovada_por_liveness_propaga_false_no_failure()
    {
        var adapter = new MockNitgenAdapter { NextCaptureSucceeds = false, NextLivenessPassed = false };
        var (proc, handler, _) = Make(adapter, new List<SyncedTemplate>());
        handler.Enqueue(HttpStatusCode.OK, "{}");

        await proc.ProcessAsync(TestData.Challenge("identify"), CancellationToken.None);

        using var doc = JsonDocument.Parse(handler.Requests.Single().Body);
        Assert.That(doc.RootElement.GetProperty("result").GetString(), Is.EqualTo("failure"));
        Assert.That(doc.RootElement.GetProperty("proof").GetProperty("liveness_passed").GetBoolean(), Is.False,
            "um 'false' real do SDK nunca é omitido");
    }

    [Test]
    public async Task Enroll_cifra_o_template_e_submete_no_endpoint_de_enrollment()
    {
        var adapter = new MockNitgenAdapter { NextCaptureLabel = "novo-dedo", NextQuality = 88 };
        var (proc, handler, tenantKey) = Make(adapter, new List<SyncedTemplate>(), enrollFinger: 2);
        handler.Enqueue(HttpStatusCode.OK, "{}");

        await proc.ProcessAsync(TestData.Challenge("enroll", expectedUserId: "user-5"), CancellationToken.None);

        var req = handler.Requests.Single();
        Assert.That(req.PathAndQuery, Does.Contain("/enrollment"));
        using var doc = JsonDocument.Parse(req.Body);
        var root = doc.RootElement;
        Assert.That(root.GetProperty("quality").GetInt32(), Is.EqualTo(88));
        // CRÍTICO de code review (2026-07-23): "eNBSP" é o nome do produto,
        // não um formato aceito — DEFAULT_ALLOWED_FORMATS do BFF
        // (apps/bff/src/lib/biometric-enrollment.ts) só aceita "nitgen-fmd".
        // Qualquer outro valor aqui trava esse bug de novo sem que o teste perceba.
        Assert.That(root.GetProperty("format").GetString(), Is.EqualTo("nitgen-fmd"));
        Assert.That(root.GetProperty("template_hash").GetString(), Does.StartWith("sha256:"));
        Assert.That(root.GetProperty("proof").GetProperty("matched_user_id").GetString(), Is.EqualTo("user-5"));
        Assert.That(root.GetProperty("proof").GetProperty("finger_index").GetInt32(), Is.EqualTo(2));
        // CRÍTICO de code review (2026-07-23): proof.timestamp precisa terminar
        // em "Z" — o BFF valida com Zod z.string().datetime() SEM offset:true,
        // que rejeita "+00:00" (o que DateTimeOffset.UtcNow.ToString("O") emitia
        // antes do fix). Sem isto, TODO /proof e /enrollment falhava com 400
        // "Invalid datetime" antes de qualquer lógica de negócio rodar.
        Assert.That(root.GetProperty("proof").GetProperty("timestamp").GetString(), Does.EndWith("Z"),
            "timestamp precisa terminar em Z (não +00:00) — Zod .datetime() sem offset:true rejeita offset explícito");

        // O template cifrado enviado decifra de volta com a tenant key → o FIR capturado.
        var encrypted = Convert.FromBase64String(root.GetProperty("encrypted_template_data").GetString()!);
        var decrypted = TemplateCipher.Decrypt(encrypted, tenantKey);
        Assert.That(Encoding.UTF8.GetString(decrypted), Is.EqualTo("mock-fir:novo-dedo"));

        // template_hash é sobre o CIPHERTEXT (spec 2.7), não o plaintext.
        var expectedHash = "sha256:" + Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(encrypted)).ToLowerInvariant();
        Assert.That(root.GetProperty("template_hash").GetString(), Is.EqualTo(expectedHash));
    }

    [Test]
    public async Task Enroll_sem_expected_user_id_nao_captura_nem_submete()
    {
        var adapter = new MockNitgenAdapter();
        var (proc, handler, _) = Make(adapter, new List<SyncedTemplate>());

        await proc.ProcessAsync(TestData.Challenge("enroll", expectedUserId: null), CancellationToken.None);

        Assert.That(handler.Requests, Is.Empty, "enroll sem expected_user_id é ignorado antes de qualquer chamada");
    }

    // ALTO de code review (2026-07-23): IsProcessing precisa voltar a false
    // mesmo em caminhos de falha/early-return — sem isto, TrayApp.ShowPairingDialog
    // ficaria bloqueado pra sempre depois do primeiro challenge que falha
    // (captura ruim, sem match, etc.), impedindo repareamento legítimo.
    [Test]
    public async Task IsProcessing_volta_a_false_apos_sucesso_e_apos_falha()
    {
        var okAdapter = new MockNitgenAdapter { NextCaptureLabel = "finger-1" };
        var (procOk, handlerOk, _) = Make(okAdapter, new List<SyncedTemplate>());
        handlerOk.Enqueue(HttpStatusCode.OK, "{}");
        Assert.That(procOk.IsProcessing, Is.False, "nunca deve começar true");
        await procOk.ProcessAsync(TestData.Challenge("identify"), CancellationToken.None);
        Assert.That(procOk.IsProcessing, Is.False, "precisa resetar após processar com sucesso (sem match, mas processou)");

        var failAdapter = new MockNitgenAdapter { NextCaptureSucceeds = false };
        var (procFail, handlerFail, _) = Make(failAdapter, new List<SyncedTemplate>());
        handlerFail.Enqueue(HttpStatusCode.OK, "{}");
        await procFail.ProcessAsync(TestData.Challenge("identify"), CancellationToken.None);
        Assert.That(procFail.IsProcessing, Is.False, "precisa resetar mesmo quando a captura falha (finally, não só caminho feliz)");
    }
}
