namespace BridgeClient;

static class Program
{
    /// <summary>
    /// Entry point do Andrômeda Bridge Client (spec Fase 1C). App de bandeja
    /// (NotifyIcon) — sem janela principal; a única UI é o ícone da bandeja e
    /// a janela de pareamento sob demanda. Seleciona o adapter do SDK: real
    /// (NitgenSdkAdapter) quando compilado com o símbolo NITGEN_SDK (DLL
    /// presente), senão o mock — o mesmo mock dos testes, útil pra rodar o
    /// bridge sem leitor físico durante desenvolvimento.
    /// </summary>
    // Espera antes de subir quando iniciado pelo Windows: no logon dezenas de
    // programas sobem juntos; o bridge é leve, mas não precisa competir com eles.
    private const int AutostartDelaySeconds = 40;

    [STAThread]
    static void Main(string[] args)
    {
        // Utilitário de instalação: registra o início automático e sai.
        if (args.Contains("--enable-autostart"))
        {
            AutoStart.Enable();
            return;
        }

        // Instância única por sessão: início automático + abertura manual (ou
        // um segundo clique) nunca podem gerar 2 bridges disputando o mesmo
        // leitor e os mesmos challenges.
        using var singleInstance = new Mutex(initiallyOwned: true, @"Local\AndromedaBridge", out var isFirstInstance);
        if (!isFirstInstance) return;

        if (args.Contains(AutoStart.Argument))
        {
            using var self = System.Diagnostics.Process.GetCurrentProcess();
            self.PriorityClass = System.Diagnostics.ProcessPriorityClass.BelowNormal;
            Thread.Sleep(TimeSpan.FromSeconds(AutostartDelaySeconds));
            self.PriorityClass = System.Diagnostics.ProcessPriorityClass.Normal;
        }

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

        log.Info($"Andrômeda Bridge {BridgeConfig.BridgeVersion} iniciando (BFF: {config.BaseUrl})");

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
