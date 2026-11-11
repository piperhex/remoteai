using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Windows.Forms;

public static class ComputerUseAdminFixture {
    [STAThread]
    public static void Main(string[] args) {
        CleanupPrevious(args);
        var owner = Process.GetProcessById(int.Parse(args[0]));
        Application.EnableVisualStyles();
        var window = new Form { Text = "Remote AI CUA Administrator Test", Width = 480, Height = 220,
            StartPosition = FormStartPosition.CenterScreen, KeyPreview = true };
        bool elevated = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        // Use an actionable control so verify_state can inspect a trusted UIA element.
        var label = new Button { Text = elevated ? "Administrator: awaiting F6" : "Not elevated",
            Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 16) };
        window.Controls.Add(label);
        window.KeyDown += delegate(object sender, KeyEventArgs eventArgs) {
            if (eventArgs.KeyCode == Keys.F6) { label.Text = "CUA input confirmed"; label.ForeColor = Color.DarkGreen; }
            if (eventArgs.KeyCode == Keys.Escape) window.Close();
        };
        var lifetime = new System.Windows.Forms.Timer { Interval = 250 };
        lifetime.Tick += delegate { if (owner.HasExited) window.Close(); };
        lifetime.Start();
        Application.Run(window);
        lifetime.Dispose();
        owner.Dispose();
    }

    private static void CleanupPrevious(string[] args) {
        if (args.Length < 2) return;
        Process stale;
        try { stale = Process.GetProcessById(int.Parse(args[1])); }
        catch (ArgumentException) { return; }
        using (var previous = stale) {
            string previousPath = previous.MainModule.FileName;
            string directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (!string.Equals(Path.GetDirectoryName(previousPath), directory, StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(previousPath).StartsWith("administrator-window", StringComparison.OrdinalIgnoreCase)) {
                throw new InvalidOperationException("Refusing to close a process outside the test fixture directory.");
            }
            previous.Kill();
            if (!previous.WaitForExit(5000)) throw new InvalidOperationException("Previous fixture did not exit.");
        }
    }
}
