"""Verify real coturn quotas using disposable local Docker containers (no deployment)."""
from contextlib import closing
from pathlib import Path
import json
import os
import secrets
import socket
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "coturn/coturn:4.18.0-r0@sha256:bbefd3e1fdfdc0d58770fe01b581fd8b00d9f3a5580d00acb77cf719a6bc78e3"
SECRET = "local_turn_quota_test_secret_123456789"
CONTROL = "local_turn_quota_control_1234567890"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def port(name, target):
    return docker("port", name, target).rsplit(":", 1)[1]


def wait_ready(name, target):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", int(port(name, target))), timeout=1):
                return
        except (OSError, subprocess.CalledProcessError):
            time.sleep(0.2)
    raise RuntimeError("Local test service did not become ready")


def shared_port():
    # Windows reserves different TCP/UDP port ranges; verify both before Docker binds.
    for _ in range(50):
        with closing(socket.socket()) as tcp, closing(socket.socket(type=socket.SOCK_DGRAM)) as udp:
            value = 20000 + secrets.randbelow(25000)
            try:
                tcp.bind(("127.0.0.1", value))
                udp.bind(("127.0.0.1", value))
                return value
            except OSError:
                continue
    raise RuntimeError("No shared local TCP/UDP port available")


def run_tests(environment, *arguments):
    subprocess.run(["go", "test", *arguments, "-count=1", "-v"], cwd=ROOT, env=environment, check=True)


def verify(directory, names):
    database, turn = names
    docker("run", "-d", "--name", database, "-p", "127.0.0.1::5432", "-e", "POSTGRES_DB=turnquota",
           "-e", "POSTGRES_PASSWORD=turn-quota-local-only", "postgres:16-alpine")
    backend = shared_port()
    docker("run", "-d", "--name", turn, "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
           "--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE", "--security-opt", "no-new-privileges:true",
           "-p", "127.0.0.1::5766", "-p", f"127.0.0.1:{backend}:3478/tcp",
           "-p", f"127.0.0.1:{backend}:3478/udp", "-e", f"DESKTOP_TURN_SECRET={SECRET}",
           "-e", f"DESKTOP_TURN_CONTROL_PASSWORD={CONTROL}", "-e", "DESKTOP_TURN_REALM=codex-switch",
           "-e", "DESKTOP_TURN_PUBLIC_IP=127.0.0.1", "--mount",
           f"type=bind,source={ROOT / 'scripts' / 'turn-entrypoint.sh'},target=/opt/codex/entrypoint.sh,readonly",
           "--mount", f"type=bind,source={directory},target=/var/lib/codex-switch/turn-quota,readonly",
           "--entrypoint", "/bin/sh", IMAGE, "/opt/codex/entrypoint.sh")
    wait_ready(turn, "5766/tcp")
    for _ in range(100):
        ready = subprocess.run(["docker", "exec", database, "pg_isready", "-U", "postgres"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ready.returncode == 0:
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("Local PostgreSQL did not become ready")
    environment = {**os.environ, "TURN_QUOTA_TEST_DIR": str(directory),
                   "TURN_QUOTA_TEST_CONTROL": "127.0.0.1:" + port(turn, "5766/tcp"),
                   "TURN_QUOTA_TEST_BACKEND": f"127.0.0.1:{backend}",
                   "TURN_QUOTA_TEST_DATABASE_URL":
                   "postgres://postgres:turn-quota-local-only@127.0.0.1:"
                   + port(database, "5432/tcp") + "/turnquota?sslmode=disable"}
    environment.pop("TURN_QUOTA_TEST_RESTARTED", None)
    run_tests({**environment, "TURN_QUOTA_TEST_INITIAL": "1"},
              "./internal/turnquota", "-run", "^TestInitialCoturnDefault$")
    run_tests(environment, "./internal/turnquota", "-run",
              "^Test(RealAllocationAdmission|PolicyValidationAndLegacyDefault|BootstrapAtomicReplacement|"
              "PersistenceAndSyncRecovery|WorkerRecoversRuntimeDrift)$")
    docker("restart", turn)
    wait_ready(turn, "5766/tcp")
    # Docker may assign a different random host port on restart; container port stays 5766.
    environment["TURN_QUOTA_TEST_CONTROL"] = "127.0.0.1:" + port(turn, "5766/tcp")
    run_tests({**environment, "TURN_QUOTA_TEST_RESTARTED": "1"}, "./internal/turnquota", "-run", "^TestRestartedQuota$")
    run_tests(environment, "./internal/content", "-run", "^TestTurnQuota")
    run_tests(environment, "./internal/server", "-run", "TestKong")
    run_tests(environment, "./internal/mediarelay")


def main():
    endpoint = json.loads(docker("context", "inspect"))[0]["Endpoints"]["docker"]["Host"]
    if os.environ.get("DOCKER_HOST") or not endpoint.startswith(("npipe://", "unix://")):
        raise RuntimeError("Use a local Docker context with no DOCKER_HOST override")
    prefix = "turn-quota-test-" + uuid.uuid4().hex[:10]
    names = [prefix + "-db", prefix + "-turn"]
    # All mounts, published loopback ports and containers belong to this test invocation.
    with tempfile.TemporaryDirectory(prefix=prefix) as directory:
        os.chmod(directory, 0o755)  # coturn's nobody user must read the non-secret restart snapshot.
        try:
            verify(Path(directory), names)
        finally:
            for name in reversed(names):
                subprocess.run(["docker", "rm", "-f", name], check=False,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
