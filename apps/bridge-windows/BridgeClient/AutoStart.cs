using Microsoft.Win32;

namespace BridgeClient;

/// <summary>
/// Início automático com o Windows via chave Run do usuário (HKCU — não exige
/// administrador e vale só pro usuário do PC do leitor). O comando leva
/// --autostart: o Program espera o logon assentar antes de subir (partida leve).
/// </summary>
public static class AutoStart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "AndromedaBridge";
    public const string Argument = "--autostart";

    public static string BuildCommand(string exePath) => $"\"{exePath}\" {Argument}";

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) is string;
    }

    public static void Enable(string? exePath = null)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        key.SetValue(ValueName, BuildCommand(exePath ?? Environment.ProcessPath ?? Application.ExecutablePath));
    }

    public static void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
