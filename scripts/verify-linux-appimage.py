#!/usr/bin/env python3
"""Check the final SquashFS permissions and open the packaged app under Xvfb."""

import argparse
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time


PUBLIC_READ_EXECUTE = 0o555
STARTUP_TIMEOUT_SECONDS = 45
WINDOW_TITLE = "Remote AI"


def verify_permissions(app_dir):
    for relative in ("AppRun", "AppRun.wrapped", "usr/bin/csw"):
        executable = (app_dir / relative).resolve(strict=True)
        if not executable.is_relative_to(app_dir) or not executable.is_file():
            raise RuntimeError(f"Invalid packaged executable: {relative}")
        paths = [executable, *executable.parents]
        for path in paths:
            if not path.is_relative_to(app_dir):
                break
            mode = stat.S_IMODE(path.stat().st_mode)
            if mode & PUBLIC_READ_EXECUTE != PUBLIC_READ_EXECUTE:
                raise RuntimeError(f"Missing public read/execute permissions: {path.relative_to(app_dir)} ({mode:04o})")
        print(f"Verified {relative}: {stat.S_IMODE(executable.stat().st_mode):04o}", flush=True)


def extract_appimage(appimage, destination):
    offset = subprocess.check_output([str(appimage), "--appimage-offset"], text=True).strip()
    if not offset.isdecimal():
        raise RuntimeError("AppImage did not return a valid SquashFS offset.")
    subprocess.run(
        ["unsquashfs", "-no-progress", "-d", str(destination), "-o", offset, str(appimage)],
        check=True, stdout=subprocess.DEVNULL,
    )


def wait_for_window(process):
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"AppImage exited before opening its window: {process.returncode}")
        window = subprocess.run(
            ["xwininfo", "-name", WINDOW_TITLE, "-stats"], capture_output=True, text=True, timeout=5,
        )
        if window.returncode == 0 and "Map State: IsViewable" in window.stdout:
            print("Verified visible Remote AI window.", flush=True)
            return
        time.sleep(0.5)
    raise RuntimeError("AppImage did not open a visible window within 45 seconds.")


def probe_window(app_dir):
    if os.geteuid() == 0:
        raise RuntimeError("Run the startup check as a non-root user.")
    with tempfile.TemporaryDirectory(prefix="appimage-home-") as directory:
        env = isolated_environment(Path(directory))
        with tempfile.TemporaryFile(mode="w+") as log:
            process = subprocess.Popen(
                [str(app_dir / "AppRun")], cwd=directory, env=env,
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
            )
            try:
                wait_for_window(process)
            finally:
                stop_process_group(process)
                log.seek(0)
                print(log.read(), end="", flush=True)


def isolated_environment(directory):
    env = os.environ.copy()
    for variable, child in (
        ("HOME", "home"), ("XDG_CONFIG_HOME", "config"), ("XDG_CACHE_HOME", "cache"),
        ("XDG_DATA_HOME", "data"), ("XDG_RUNTIME_DIR", "runtime"),
    ):
        path = directory / child
        path.mkdir(mode=0o700)
        env[variable] = str(path)
    # Xvfb has no hardware renderer. Keep WebKit's sandbox enabled.
    env["WEBKIT_DISABLE_DMABUF_RENDERER"] = "1"
    env["LIBGL_ALWAYS_SOFTWARE"] = "1"
    # GTK otherwise prefers an inherited Wayland session (for example WSLg),
    # placing the window outside Xvfb where xwininfo cannot observe it.
    env["GDK_BACKEND"] = "x11"
    env.pop("WAYLAND_DISPLAY", None)
    return env


def stop_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def verify_appimage(appimage, permissions_only):
    with tempfile.TemporaryDirectory(prefix="appimage-check-") as directory:
        app_dir = Path(directory) / "AppDir"
        extract_appimage(appimage, app_dir)
        verify_permissions(app_dir)
        if not permissions_only:
            subprocess.run(
                ["xvfb-run", "-a", "dbus-run-session", "--", sys.executable,
                 str(Path(__file__).resolve()), "--probe", str(app_dir)],
                check=True, timeout=STARTUP_TIMEOUT_SECONDS + 20,
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--permissions-only", action="store_true")
    parser.add_argument("--probe", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.probe:
        probe_window(args.path.resolve(strict=True))
    else:
        verify_appimage(args.path.resolve(strict=True), args.permissions_only)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(f"AppImage verification failed: {error}")
