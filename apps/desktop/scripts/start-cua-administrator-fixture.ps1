param(
    [Parameter(Mandatory = $true)][string]$FixturePath,
    [Parameter(Mandatory = $true)][uint32]$FixtureOwnerId,
    [uint32]$PreviousFixtureId = 0
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$resolvedFixture = (Resolve-Path -LiteralPath $FixturePath).Path
$fixtureDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../.codex-tmp/cua-administrator/interactive'))
if ([IO.Path]::GetDirectoryName($resolvedFixture) -ine $fixtureDirectory -or
    [IO.Path]::GetFileName($resolvedFixture) -notlike 'administrator-window*.exe') {
    throw 'The interactive fixture must be inside the dedicated test directory.'
}

# Match the product's ShellExecuteEx flags and keep the consent prompt associated with the visible app.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CuaAdministratorFixtureLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShellExecuteInfo {
        public uint size, mask;
        public IntPtr window;
        [MarshalAs(UnmanagedType.LPWStr)] public string verb, file, parameters, directory;
        public int show;
        public IntPtr instance, idList;
        [MarshalAs(UnmanagedType.LPWStr)] public string className;
        public IntPtr classKey;
        public uint hotKey;
        public IntPtr icon, process;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ShellExecuteExW(ref ShellExecuteInfo info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] private static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    public static uint Start(string file, string arguments) {
        var info = new ShellExecuteInfo {
            size = (uint)Marshal.SizeOf(typeof(ShellExecuteInfo)),
            mask = 0x40 | 0x100, // SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC
            window = GetForegroundWindow(), verb = "runas", file = file,
            parameters = arguments, show = 5 // SW_SHOW: the interactive target must be visible.
        };
        if (!ShellExecuteExW(ref info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (info.process == IntPtr.Zero) throw new InvalidOperationException("No fixture process handle.");
        try { return GetProcessId(info.process); }
        finally { CloseHandle(info.process); }
    }
}
'@
$fixtureArguments = "$FixtureOwnerId"
if ($PreviousFixtureId -ne 0) { $fixtureArguments += " $PreviousFixtureId" }
[CuaAdministratorFixtureLauncher]::Start($resolvedFixture, $fixtureArguments)
