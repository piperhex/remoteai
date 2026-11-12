param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$result = [PSCustomObject]@{
    Elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Time = (Get-Date).ToString('s')
    Computer = $env:COMPUTERNAME
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'authorization.json') -Encoding UTF8
if (-not $result.Elevated) { throw 'The diagnostic needs the Windows administrator confirmation.' }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GroupingDiagnosticWindow {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
}
'@

# This one-shot observer reads only Task Manager and exits. It accepts no commands.
$manager = Get-Process -Name Taskmgr | Select-Object -First 1
if (-not $manager) { throw 'Open Task Manager before running the grouping diagnostic.' }
$handle = $manager.MainWindowHandle
try {
    $sample = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TreeItem)))
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $rows = for ($index = 0; $index -lt $elements.Count; $index++) {
        $element = $elements.Item($index)
        $properties = $element.Current
        if ($properties.Name) {
            $parent = $walker.GetParent($element).Current
            [PSCustomObject]@{ Name=$properties.Name; Type=$properties.ControlType.ProgrammaticName;
                AutomationId=$properties.AutomationId; Offscreen=$properties.IsOffscreen;
                ParentName=$parent.Name; ParentId=$parent.AutomationId }
        }
    }
    $rows | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputDirectory "taskmgr-$sample.json") -Encoding UTF8
    $bounds = $window.Current.BoundingRectangle
    $bitmap = New-Object Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $dc = $graphics.GetHdc()
        try { [GroupingDiagnosticWindow]::PrintWindow($handle, $dc, 2) | Out-Null }
        finally { $graphics.ReleaseHdc($dc) }
        $bitmap.Save((Join-Path $OutputDirectory "taskmgr-$sample.png"), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
} catch { $_ | Out-String | Set-Content -LiteralPath (Join-Path $OutputDirectory 'error.txt'); throw }
