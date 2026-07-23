namespace BridgeClient;

static class Program
{
    /// <summary>
    /// Entry point do APMCB Bridge Client (spec Fase 1C). App de bandeja
    /// (NotifyIcon) — sem janela principal; a única UI é o ícone da bandeja e
    /// a janela de pareamento sob demanda. Seleciona o adapter do SDK: real
    /// (NitgenSdkAdapter) quando compilado com o símbolo NITGEN_SDK (DLL
    /// presente), senão o mock — o mesmo mock dos testes, útil pra rodar o
    /// bridge sem leitor físico durante desenvolvimento.
    /// </summary>
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();

        var config = BridgeConfig.FromEnvironment();
        var log = new BridgeLogger();
        var keyStore = new KeyStore();
        var adapter = CreateAdapter(log);

        // Popula o pinning ANTES de qualquer serviço construir um HttpClient
        // (DeviceAuthClient/PairingService leem CertificatePinning.PinnedSpkiSha256Hex
        // no momento da requisição, não da construção — mas isto precisa
        // acontecer antes da primeira chamada real, que pode disparar
        // segundos depois de TrayApp.Start()). Vazio = fail-open documentado
        // (CertificatePinning.ValidateChain), nunca fail-closed silencioso.
        foreach (var pin in config.PinnedSpkiSha256Hex)
        {
            CertificatePinning.PinnedSpkiSha256Hex.Add(pin);
        }
        log.Info(config.PinnedSpkiSha256Hex.Count > 0
            ? $"certificate pinning ativo ({config.PinnedSpkiSha256Hex.Count} pin(s))"
            : "certificate pinning INATIVO — APMCB_BRIDGE_PINNED_SPKI_SHA256 não configurada, caindo pra validação TLS padrão do SO");

        log.Info($"APMCB Bridge {BridgeConfig.BridgeVersion} iniciando (BFF: {config.BaseUrl})");

        using var tray = new TrayApp(config, keyStore, log, adapter);
        tray.Start();
        Application.Run();

        adapter.Dispose();
    }

    private static INitgenAdapter CreateAdapter(BridgeLogger log)
    {
#if NITGEN_SDK
        return new NitgenSdkAdapter(log);
#else
        log.Warn("SDK NITGEN não compilado (NITGEN_SDK ausente) — usando MockNitgenAdapter");
        return new MockNitgenAdapter();
#endif
    }
}
