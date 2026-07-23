using System.ComponentModel;

namespace BridgeClient;

/// <summary>
/// Janela mínima de pareamento (spec seção 6, passo 3): SÓ o campo do código
/// + botão "Parear". Sem campo de nome — o device_name vem do código
/// (escolhido pelo admin ao gerar). Fecha sozinha no sucesso.
/// </summary>
public sealed class PairingForm : Form
{
    private readonly PairingService _pairingService;
    private readonly TextBox _codeInput;
    private readonly Button _pairButton;
    private readonly Label _status;

    public bool Paired { get; private set; }

    public PairingForm(PairingService pairingService)
    {
        _pairingService = pairingService;

        Text = "APMCB Bridge — Parear leitor";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(380, 170);

        var label = new Label
        {
            Text = "Digite o código de pareamento gerado no painel admin:",
            Location = new Point(16, 18),
            Size = new Size(348, 20),
        };

        _codeInput = new TextBox
        {
            Location = new Point(16, 44),
            Size = new Size(348, 27),
            PlaceholderText = "APMCB-XXXX-XXXX",
            CharacterCasing = CharacterCasing.Upper,
        };

        _pairButton = new Button
        {
            Text = "Parear",
            Location = new Point(264, 82),
            Size = new Size(100, 30),
        };
        _pairButton.Click += OnPairClick;

        _status = new Label
        {
            Location = new Point(16, 124),
            Size = new Size(348, 36),
            ForeColor = Color.FromArgb(180, 30, 30),
        };

        Controls.AddRange([label, _codeInput, _pairButton, _status]);
        AcceptButton = _pairButton;
    }

    private async void OnPairClick(object? sender, EventArgs e)
    {
        var code = _codeInput.Text.Trim();
        if (code.Length == 0)
        {
            _status.Text = "Informe o código de pareamento.";
            return;
        }

        _pairButton.Enabled = false;
        _codeInput.Enabled = false;
        _status.ForeColor = Color.FromArgb(90, 90, 90);
        _status.Text = "Pareando…";

        var result = await _pairingService.PairAsync(code);

        if (result.Success)
        {
            Paired = true;
            DialogResult = DialogResult.OK;
            Close();
            return;
        }

        _status.ForeColor = Color.FromArgb(180, 30, 30);
        _status.Text = result.Error ?? "Falha ao parear.";
        _pairButton.Enabled = true;
        _codeInput.Enabled = true;
    }
}
