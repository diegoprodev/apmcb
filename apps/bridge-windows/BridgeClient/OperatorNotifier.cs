namespace BridgeClient;

/// <summary>
/// Aviso amigável ao operador no PC do leitor (o bridge não tem tela própria
/// além da bandeja). Roda em thread separada pra nunca travar o polling.
/// </summary>
public static class OperatorNotifier
{
    public static void Warn(string title, string message)
    {
        Task.Run(() => MessageBox.Show(
            message,
            title,
            MessageBoxButtons.OK,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button1,
            (MessageBoxOptions)0x40000 /* MB_TOPMOST */));
    }
}
