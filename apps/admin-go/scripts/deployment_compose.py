#!/usr/bin/env python3
"""One Compose entrypoint for checking, updating and verifying the deployed Go service."""

import argparse
import json
from pathlib import Path
import subprocess
import sys

from deployment_relay import (
    ADMIN_SERVICE, TURN_SERVICE, DeploymentError, environment, relay_enabled,
    validate_configuration, verify_runtime,
)


ADMIN_ROOT = Path(__file__).resolve().parents[1]
COMPOSE_FILES_LABEL = "com.docker.compose.project.config_files"
COMMAND_TIMEOUT_SECONDS = 30
UPDATE_TIMEOUT_SECONDS = 180


def capture(arguments, timeout=COMMAND_TIMEOUT_SECONDS):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, encoding="utf-8",
                                timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        message = "Docker could not be queried. Check its connection and retry the read-only check."
        raise DeploymentError(message) from error
    if result.returncode:
        # Compose errors can include interpolated values from private environment files.
        raise DeploymentError("Docker inspection or Compose validation failed. Check the deployment configuration.")
    return result.stdout


def container_for(project, service):
    ids = capture(["docker", "ps", "--all", "--quiet", "--filter",
                   f"label=com.docker.compose.project={project}", "--filter",
                   f"label=com.docker.compose.service={service}"]).split()
    if not ids:
        return {}
    if len(ids) != 1:
        raise DeploymentError(f"Multiple {service} containers exist in this project; inspect them before deploying.")
    return json.loads(capture(["docker", "inspect", ids[0]]))[0]


def compose_files(root, previous, extra):
    """Retain the recorded order, including private overrides and optional service fragments."""
    recorded = previous.get("Config", {}).get("Labels", {}).get(COMPOSE_FILES_LABEL, "")
    files = [Path(value).resolve() for value in recorded.split(",") if value]
    if not files:
        files = [root / "compose.yml"]
        override = root / "compose.override.yml"
        if override.is_file():
            files.append(override)
    for value in extra:
        path = Path(value).resolve()
        if path not in files:
            files.append(path)
    if root / "compose.yml" not in files:
        raise DeploymentError("The recorded deployment does not use this Go Compose file; inspect it first.")
    for path in files:
        if not path.is_file():
            raise DeploymentError(f"A recorded Compose file is unavailable: {path.name}. Restore it before deploying.")
    return files


class Deployment:
    def __init__(self, options):
        self.options = options
        self.root = options.root.resolve()
        self.previous = container_for(options.project_name, ADMIN_SERVICE)
        self.files = compose_files(self.root, self.previous, options.file)
        if relay_enabled(environment(self.previous)):
            self.include_relay()
        self.config = self.render()
        if relay_enabled(self.config["services"][ADMIN_SERVICE].get("environment", {})) and self.include_relay():
            self.config = self.render()
        self.required = validate_configuration(self.config, self.previous)

    def include_relay(self):
        path = self.root / "compose.desktop-relay.yml"
        if not path.is_file():
            raise DeploymentError("TURN is enabled, but compose.desktop-relay.yml is missing.")
        if path in self.files:
            return False
        self.files.append(path)
        return True

    def command(self):
        env_file = self.options.env_file or self.root / ".env"
        arguments = ["docker", "compose", "--project-name", self.options.project_name,
                     "--env-file", str(Path(env_file).resolve())]
        for path in self.files:
            arguments.extend(["-f", str(path)])
        return arguments

    def render(self):
        return json.loads(capture(self.command() + ["config", "--format", "json"]))

    def verify(self):
        services = [ADMIN_SERVICE, TURN_SERVICE] if self.required else [ADMIN_SERVICE]
        containers = {name: container_for(self.options.project_name, name) for name in services}
        verify_runtime(self.config, containers)

    def update(self):
        arguments = self.command() + ["up", "-d", "--no-deps", "--no-build", "--pull", "never"]
        if self.options.force_recreate:
            arguments.append("--force-recreate")
        if self.options.update_turn and not self.required:
            raise DeploymentError("--update-turn requires an enabled TURN relay.")
        try:
            if self.options.update_turn:
                capture(arguments + [TURN_SERVICE], timeout=UPDATE_TIMEOUT_SECONDS)
            capture(arguments + [ADMIN_SERVICE], timeout=UPDATE_TIMEOUT_SECONDS)
        except DeploymentError as error:
            message = "admin-go update failed. Inspect its state and use the recorded rollback image."
            raise DeploymentError(message) from error
        self.verify()

    def summary(self):
        return {
            "action": self.options.action,
            "project": self.options.project_name,
            "composeFiles": [str(path) for path in self.files],
            "relayEnabled": bool(self.required),
            "relayPorts": [f"{public}/{protocol}" for _, protocol, public in sorted(self.required)],
        }


def parse_options(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "up", "verify"], help="Only up changes the running service")
    parser.add_argument("--project-name", default="admin-go")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--file", type=Path, action="append", default=[],
                        help="Additional Compose override; repeatable")
    parser.add_argument("--force-recreate", action="store_true",
                        help="Recreate admin-go when restoring a verified image")
    parser.add_argument("--update-turn", action="store_true",
                        help="Also update coturn for explicit relay configuration changes; interrupts active relays")
    parser.set_defaults(root=ADMIN_ROOT)
    options = parser.parse_args(arguments)
    if options.force_recreate and options.action != "up":
        parser.error("--force-recreate is only valid with up")
    if options.update_turn and options.action != "up":
        parser.error("--update-turn is only valid with up")
    return options


def main(arguments=None):
    try:
        deployment = Deployment(parse_options(arguments))
        if deployment.options.action == "up":
            deployment.update()
        elif deployment.options.action == "verify":
            deployment.verify()
        print(json.dumps(deployment.summary(), ensure_ascii=False))
        return 0
    except (DeploymentError, ValueError, KeyError, OSError) as error:
        # JSON decoding/OS errors may contain private output or invocation details.
        message = str(error) if isinstance(error, DeploymentError) else "Deployment configuration could not be read."
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
