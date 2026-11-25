param([Parameter(Mandatory = $true)][string]$Fixture)
$ErrorActionPreference = 'Stop'
$hosts = @(Get-Process -Name inspector-smoke | Where-Object { $_.Path -eq $Fixture })
if ($hosts.Count -ne 1) { throw 'Expected one running inspector fixture.' }

# Inspect the tagged DevTools HWND even while hidden. Host DOM visibility cannot detect a sibling HWND.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InspectorProbe {
    delegate bool Visit(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visit visit, IntPtr state);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetProp(IntPtr hwnd, string key);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    public static IntPtr Find(IntPtr parent) {
        if (parent == IntPtr.Zero) throw new InvalidOperationException("Missing fixture window");
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (hwnd, state) => {
            if (GetProp(hwnd, "RemoteAI.Inspector") == IntPtr.Zero) return true;
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) throw new InvalidOperationException("Missing docked DevTools");
        return found;
    }
}
'@
$inspector = [InspectorProbe]::Find($hosts[0].MainWindowHandle)
@{ handle = $inspector.ToInt64(); visible = [InspectorProbe]::IsWindowVisible($inspector) } | ConvertTo-Json -Compress
