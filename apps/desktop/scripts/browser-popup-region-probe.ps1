param([Parameter(Mandatory = $true)][uint32]$ProcessId)
$ErrorActionPreference = 'Stop'

# Read the actual Win32 clipping region during an opening animation. DOM screenshots cannot
# detect pixels clipped by the native host, which caused the original icon/width regression.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class BrowserPopupRegionProbe {
    [StructLayout(LayoutKind.Sequential)]
    struct Rect { public int Left, Top, Right, Bottom; }
    delegate bool EnumWindow(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow visit, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr region, out Rect rect);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    public class Sample {
        public long Time;
        public bool Visible;
        public int Left, Top, Right, Bottom;
    }
    public static IntPtr Find(uint process) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, state) => {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            var name = new StringBuilder(128);
            GetClassName(hwnd, name, name.Capacity);
            if (owner == process && name.ToString() == "RemoteAIBrowserPopup") found = hwnd;
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) throw new InvalidOperationException("Fixture popup not found");
        return found;
    }
    public static List<Sample> Read(IntPtr hwnd) {
        var previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
        var samples = new List<Sample>();
        var region = CreateRectRgn(0, 0, 0, 0);
        if (region == IntPtr.Zero) throw new InvalidOperationException("Cannot create probe region");
        var clock = Stopwatch.StartNew();
        try {
            while (clock.ElapsedMilliseconds < 1000) {
                Rect bounds = new Rect();
                bool visible = IsWindowVisible(hwnd);
                if (visible && (GetWindowRgn(hwnd, region) == 0 || GetRgnBox(region, out bounds) == 0))
                    throw new InvalidOperationException("Cannot read native popup region");
                samples.Add(new Sample { Time = clock.ElapsedMilliseconds, Visible = visible,
                    Left = bounds.Left, Top = bounds.Top, Right = bounds.Right, Bottom = bounds.Bottom });
                Thread.Sleep(5);
            }
        } finally { DeleteObject(region); SetThreadDpiAwarenessContext(previousDpi); }
        return samples;
    }
}
'@
$popupWindow = [BrowserPopupRegionProbe]::Find($ProcessId)
[Console]::WriteLine('READY')
$null = [Console]::ReadLine()
[BrowserPopupRegionProbe]::Read($popupWindow) | ConvertTo-Json -Compress
