namespace BridgeClient;

/// <summary>
/// App de bandeja (spec seção 4 — modelo de processo escolhido: tray na
/// sessão do usuário logado, não Windows Service, pra evitar o risco de
/// isolamento de sessão 0 no acesso USB). Ícone comunica o estado (spec
/// seção 6, passo 4): cinza = não pareado; amarelo = pareado, aguardando
/// leitor; verde = leitor detectado. Menu: parear, abrir logs, sair.
/// </summary>
public sealed class TrayApp : IDisposable
{
    private readonly BridgeConfig _config;
    private readonly KeyStore _keyStore;
    private readonly BridgeLogger _log;
    private readonly INitgenAdapter _adapter;
    private readonly NotifyIcon _notifyIcon;
    private readonly System.Windows.Forms.Timer _statusTimer;
    private BridgeOrchestrator? _orchestrator;

    private enum Status { Unpaired, WaitingReader, Ready, Revoked }
    private Status _status = Status.Unpaired;

    public TrayApp(BridgeConfig config, KeyStore keyStore, BridgeLogger log, INitgenAdapter adapter)
    {
        _config = config;
        _keyStore = keyStore;
        _log = log;
        _adapter = adapter;

        _notifyIcon = new NotifyIcon
        {
            Visible = true,
            Text = "APMCB Bridge",
            Icon = MakeIcon(Color.Gray),
            ContextMenuStrip = BuildMenu(),
        };

        _statusTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        _statusTimer.Tick += (_, _) => RefreshStatus();
    }

    public void Start()
    {
        if (_keyStore.HasPairedDevice)
        {
            StartOrchestrator();
        }
        else
        {
            SetStatus(Status.Unpaired);
            // Sem device: abre o pareamento na primeira execução (spec 6, passo 3).
            ShowPairingDialog();
        }
        _statusTimer.Start();
    }

    private void StartOrchestrator()
    {
        _orchestrator?.Dispose();
        _orchestrator = new BridgeOrchestrator(_config, _keyStore, _log, _adapter);
        if (_orchestrator.Start())
        {
            SetStatus(Status.WaitingReader);
        }
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Parear leitor…", null, (_, _) => ShowPairingDialog());
        menu.Items.Add("Abrir pasta de logs", null, (_, _) => OpenLogsFolder());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair", null, (_, _) => ExitApp());
        return menu;
    }

    private void ShowPairingDialog()
    {
        // ALTO de code review (2026-07-23): repareamento reabre o MESMO
        // INitgenAdapter/device nativo compartilhado (StartOrchestrator).
        // Capture/Enroll são chamadas síncronas bloqueantes no SDK (até 30s),
        // sem cancelamento real — repareamento no meio de uma captura corria
        // o risco de duas "sessões" tocando o mesmo handle nativo ao mesmo
        // tempo. Bloqueia o caminho manual mais comum; ver BridgeOrchestrator.Stop
        // pra a defesa complementar (não fecha o device se o task não terminou).
        if (_orchestrator?.IsProcessingChallenge == true)
        {
            _notifyIcon.ShowBalloonTip(3000, "APMCB Bridge",
                "Aguarde a captura em andamento terminar antes de parear um novo leitor.", ToolTipIcon.Warning);
            return;
        }

        var pairingService = new PairingService(_config.BaseUrl, _keyStore, _log);
        using var form = new PairingForm(pairingService);
        if (form.ShowDialog() == DialogResult.OK && form.Paired)
        {
            _notifyIcon.ShowBalloonTip(3000, "APMCB Bridge", "Leitor pareado com sucesso.", ToolTipIcon.Info);
            StartOrchestrator();
        }
    }

    private void RefreshStatus()
    {
        if (!_keyStore.HasPairedDevice)
        {
            SetStatus(Status.Unpaired);
            return;
        }
        // MÉDIO de code review (2026-07-23): 401/403 persistente no heartbeat
        // significa device revogado no painel admin (ex: PC roubado) — sem
        // isto, o ícone ficava verde indefinidamente mesmo com o BFF
        // rejeitando toda chamada, escondendo exatamente o sinal que a
        // revogação deveria expor pro operador local.
        if (_orchestrator?.Heartbeat?.LastStatus == HeartbeatStatus.AuthRejected)
        {
            SetStatus(Status.Revoked);
            return;
        }
        // device_detected do último heartbeat determina verde vs amarelo.
        var detected = _orchestrator?.Heartbeat?.LastDeviceDetected ?? _adapter.IsDeviceDetected;
        SetStatus(detected ? Status.Ready : Status.WaitingReader);
    }

    private void SetStatus(Status status)
    {
        if (_status == status && _notifyIcon.Icon is not null) return;
        _status = status;
        var (color, text) = status switch
        {
            Status.Ready => (Color.FromArgb(40, 170, 70), "APMCB Bridge — leitor pronto"),
            Status.WaitingReader => (Color.FromArgb(220, 170, 40), "APMCB Bridge — aguardando leitor"),
            Status.Revoked => (Color.FromArgb(200, 40, 40), "APMCB Bridge — leitor REVOGADO, parear novamente"),
            _ => (Color.Gray, "APMCB Bridge — não pareado"),
        };
        var old = _notifyIcon.Icon;
        _notifyIcon.Icon = MakeIcon(color);
        _notifyIcon.Text = text;
        old?.Dispose();
    }

    private void OpenLogsFolder()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "APMCB", "BridgeClient");
        Directory.CreateDirectory(dir);
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = dir, UseShellExecute = true });
    }

    private void ExitApp()
    {
        _statusTimer.Stop();
        _orchestrator?.Dispose();
        _notifyIcon.Visible = false;
        Application.Exit();
    }

    /// <summary>Ícone de bandeja gerado em memória — um disco colorido 16x16 (sem asset externo).</summary>
    private static Icon MakeIcon(Color color)
    {
        using var bmp = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var brush = new SolidBrush(color);
            g.FillEllipse(brush, 2, 2, 12, 12);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    public void Dispose()
    {
        _statusTimer.Dispose();
        _orchestrator?.Dispose();
        _notifyIcon.Dispose();
    }
}
