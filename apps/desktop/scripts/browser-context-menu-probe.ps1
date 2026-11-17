param(
    [Parameter(Mandatory = $true)][uint32]$ProcessId,
    [ValidateSet('read', 'prepare', 'dismiss', 'long-press')][string]$Action = 'read',
    [string]$Screenshot,
    [int]$X,
    [int]$Y
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ContextMenuProbe {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Pointer {
        public uint Type, Id, FrameId, Flags;
        public IntPtr Source, Target;
        public Point Pixel, Himetric, PixelRaw, HimetricRaw;
        public uint Time, History;
        public int InputData;
        public uint KeyStates;
        public ulong PerformanceCount;
        public int ButtonChange;
    }
    [StructLayout(LayoutKind.Sequential)] struct Touch {
        public Pointer Pointer;
        public uint Flags, Mask;
        public Rect Contact, ContactRaw;
        public uint Orientation, Pressure;
    }
    delegate bool Visit(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(Visit visit, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after,
        int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll", SetLastError=true)] static extern bool InitializeTouchInjection(uint count, uint mode);
    [DllImport("user32.dll", SetLastError=true)] static extern bool InjectTouchInput(uint count, ref Touch touch);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int capacity, uint flags);
    public static IntPtr Find(uint process, bool menu) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, state) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != process || !IsWindowVisible(window)) return true;
            var text = new StringBuilder(256);
            if (menu) GetClassName(window, text, text.Capacity); else GetWindowText(window, text, text.Capacity);
            if (text.ToString() == (menu ? "#32768" : "Conversation browser verification")) found = window;
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static string[] Items(IntPtr window) {
        var menu = SendMessage(window, 0x01E1, IntPtr.Zero, IntPtr.Zero);
        var items = new List<string>();
        for (uint i=0; i<GetMenuItemCount(menu); i++) {
            var text = new StringBuilder(256);
            GetMenuString(menu, i, text, text.Capacity, 0x400);
            items.Add(text.ToString());
        }
        return items.ToArray();
    }
    public static void LongPress(int x, int y) {
        if (!InitializeTouchInjection(1, 3)) throw new System.ComponentModel.Win32Exception();
        var touch = new Touch { Pointer = new Pointer { Type=2, Id=0, Flags=0x10006,
            Pixel=new Point {X=x,Y=y} } };
        if (!InjectTouchInput(1, ref touch)) throw new InvalidOperationException(
            "Touch down failed: " + Marshal.GetLastWin32Error() + "; size=" + Marshal.SizeOf(typeof(Touch)));
        try {
            touch.Pointer.Flags=0x20006;
            for (int i=0; i<12; i++) {
                System.Threading.Thread.Sleep(100);
                if (!InjectTouchInput(1, ref touch)) throw new System.ComponentModel.Win32Exception(
                    Marshal.GetLastWin32Error(), "Touch update failed");
            }
        } finally {
            touch.Pointer.Flags=0x40000;
            if (!InjectTouchInput(1, ref touch)) throw new System.ComponentModel.Win32Exception(
                Marshal.GetLastWin32Error(), "Touch up failed");
        }
    }
}
'@
$previousDpi = [ContextMenuProbe]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
try {
    $window = [ContextMenuProbe]::Find($ProcessId, $false)
    if ($window -eq [IntPtr]::Zero) { throw 'Fixture window not found' }
    if ($Action -eq 'dismiss') {
        if (-not [ContextMenuProbe]::PostMessage($window, 0x001F, [IntPtr]::Zero, [IntPtr]::Zero)) {
            throw 'Could not cancel fixture menu'
        }
        return
    }
    if ($Action -eq 'prepare') {
        # Only this task's fixture is raised; no user browser or other test window is changed.
        $null = [ContextMenuProbe]::SetWindowPos($window, [IntPtr]::new(-1), 100, 100, 0, 0, 0x0001)
        $null = [ContextMenuProbe]::SetForegroundWindow($window)
        return
    }
    if ($Action -eq 'long-press') {
        $targetBounds = New-Object ContextMenuProbe+Rect
        $null = [ContextMenuProbe]::GetWindowRect($window, [ref]$targetBounds)
        if ($X -le $targetBounds.Left -or $X -ge $targetBounds.Right -or
            $Y -le $targetBounds.Top -or $Y -ge $targetBounds.Bottom) { throw 'Touch outside fixture' }
        [ContextMenuProbe]::LongPress($X, $Y)
        return
    }
    $menu = [ContextMenuProbe]::Find($ProcessId, $true)
    if ($menu -eq [IntPtr]::Zero) { throw 'Native context menu not found' }
    $bounds = New-Object ContextMenuProbe+Rect
    $menuBounds = New-Object ContextMenuProbe+Rect
    if (-not [ContextMenuProbe]::GetWindowRect($window, [ref]$bounds)) { throw 'Cannot read fixture bounds' }
    if (-not [ContextMenuProbe]::GetWindowRect($menu, [ref]$menuBounds)) { throw 'Cannot read menu bounds' }
    if ($Screenshot) {
        # The test host is temporarily topmost for unobscured captures. Raise its real menu too.
        $null = [ContextMenuProbe]::SetWindowPos($menu, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0013)
        Start-Sleep -Milliseconds 100
        $bitmap = New-Object System.Drawing.Bitmap ($bounds.Right-$bounds.Left), ($bounds.Bottom-$bounds.Top)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
            $bitmap.Save($Screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
    @{ window=$bounds; menu=$menuBounds; items=[ContextMenuProbe]::Items($menu) } | ConvertTo-Json -Compress
} finally { $null = [ContextMenuProbe]::SetThreadDpiAwarenessContext($previousDpi) }
