"""Regression coverage for deployments that accidentally remove the TURN listeners."""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import deployment_compose as compose
from deployment_relay import DeploymentError, validate_configuration, verify_runtime


RELAY_ENV = {
    "DESKTOP_TURN_URLS": "turn:relay.example.test:3479?transport=udp,"
                         "turn:relay.example.test:3479?transport=tcp,"
                         "turns:relay.example.test:5349?transport=tcp",
    "DESKTOP_TURN_LISTEN": "0.0.0.0:3479",
    "DESKTOP_TURN_TLS_LISTEN": "0.0.0.0:5349",
    "DESKTOP_TURN_SECRET": "private-test-value-must-not-appear",
    "DESKTOP_TURN_CONTROL_PASSWORD": "private-control-value-must-not-appear",
}
RELAY_PORTS = [(3479, "udp"), (3479, "tcp"), (5349, "tcp")]


def configuration(enabled=True):
    admin = {"environment": RELAY_ENV.copy() if enabled else {}, "networks": {"media-relay": {}}}
    admin["ports"] = [{"target": port, "published": str(port), "protocol": protocol, "host_ip": "0.0.0.0"}
                      for port, protocol in RELAY_PORTS] if enabled else []
    turn = {"networks": {"media-relay": {}}, "ports": [{"target": 50000, "published": "50000", "protocol": "udp"}]}
    return {"services": {"admin-go": admin, "desktop-turn": turn}}


def container(enabled=True):
    return {
        "Config": {"Env": [f"{key}={value}" for key, value in RELAY_ENV.items()] if enabled else [], "Labels": {}},
        "State": {"Running": True},
        "NetworkSettings": {"Ports": {
            f"{port}/{protocol}": [{"HostIp": "0.0.0.0", "HostPort": str(port)}]
            for port, protocol in RELAY_PORTS
        } if enabled else {}, "Networks": {"fixture_media-relay": {}}},
    }


class RelayGuardTests(unittest.TestCase):
    def test_control_port_is_never_published_even_on_loopback(self):
        config = configuration()
        config["services"]["desktop-turn"]["ports"].append({
            "target": 5766, "published": "5766", "protocol": "tcp", "host_ip": "127.0.0.1"})
        with self.assertRaises(DeploymentError):
            validate_configuration(config, {})
        turn = container()
        turn["NetworkSettings"]["Ports"] = {"5766/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5766"}]}
        with self.assertRaises(DeploymentError):
            verify_runtime(configuration(), {"admin-go": container(), "desktop-turn": turn})

    def test_each_advertised_transport_requires_its_port_before_deployment(self):
        for missing in RELAY_PORTS:
            with self.subTest(missing=missing):
                config = configuration()
                config["services"]["admin-go"]["ports"] = [
                    p for p in config["services"]["admin-go"]["ports"] if (p["target"], p["protocol"]) != missing
                ]
                with self.assertRaisesRegex(DeploymentError, "mappings are missing"):
                    validate_configuration(config, container())

    def test_loopback_and_wrong_target_do_not_count_as_public_mappings(self):
        for field, value in [("host_ip", "127.0.0.1"), ("host_ip", "::1"), ("target", 9999)]:
            with self.subTest(field=field, value=value):
                config = configuration()
                config["services"]["admin-go"]["ports"][0][field] = value
                with self.assertRaises(DeploymentError):
                    validate_configuration(config, {})

    def test_existing_relay_cannot_be_silently_disabled(self):
        with self.assertRaisesRegex(DeploymentError, "would be disabled"):
            validate_configuration(configuration(False), container())
        self.assertEqual(validate_configuration(configuration(False), {}), set())

    def test_backend_network_and_private_listener_are_checked(self):
        for broken in ["network", "private-port"]:
            config = configuration()
            turn = config["services"]["desktop-turn"]
            if broken == "network":
                turn["networks"] = {"unrelated": {}}
            else:
                turn["ports"].append({"target": 3478, "published": "3478", "host_ip": "127.0.0.1"})
            with self.subTest(broken=broken), self.assertRaises(DeploymentError):
                validate_configuration(config, {})

    def test_custom_advertised_port_maps_to_the_real_container_listener(self):
        config = configuration()
        admin = config["services"]["admin-go"]
        admin["environment"]["DESKTOP_TURN_URLS"] = "turns:relay.example.test:443?transport=tcp"
        admin["ports"] = [{"target": 5349, "published": "443", "protocol": "tcp"}]
        self.assertEqual(validate_configuration(config, {}), {(5349, "tcp", 443)})

    def test_live_ports_are_checked_even_when_desired_configuration_is_correct(self):
        admin, turn = container(), container(False)
        verify_runtime(configuration(), {"admin-go": admin, "desktop-turn": turn})
        admin["NetworkSettings"]["Ports"].pop("5349/tcp")
        with self.assertRaisesRegex(DeploymentError, "5349/tcp"):
            verify_runtime(configuration(), {"admin-go": admin, "desktop-turn": turn})

    def test_runtime_requires_enabled_relay_live_backend_and_shared_network(self):
        for broken in ["disabled", "stopped", "network", "private-port"]:
            admin, turn = container(), container(False)
            if broken == "disabled":
                admin["Config"]["Env"] = []
            elif broken == "stopped":
                turn["State"]["Running"] = False
            elif broken == "network":
                turn["NetworkSettings"]["Networks"] = {"unrelated": {}}
            else:
                turn["NetworkSettings"]["Ports"]["3478/tcp"] = [{"HostIp": "127.0.0.1", "HostPort": "3478"}]
            with self.subTest(broken=broken), self.assertRaises(DeploymentError):
                verify_runtime(configuration(), {"admin-go": admin, "desktop-turn": turn})


class ComposeEntrypointTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        for name in ["compose.yml", "compose.override.yml", "compose.desktop-relay.yml", "extra.yml"]:
            (self.root / name).write_text("services: {}", encoding="utf-8")
        self.options = compose.parse_options(["check", "--project-name", "fixture"])
        self.options.root = self.root
        self.current = container()
        self.config = configuration()
        self.commands = []

    def make_deployment(self):
        def capture(arguments):
            self.commands.append(arguments)
            config = copy.deepcopy(self.config)
            if str(self.root / "compose.desktop-relay.yml") not in arguments:
                config["services"]["admin-go"]["ports"] = []
            return json.dumps(config)
        with (patch.object(compose, "container_for", return_value=self.current),
              patch.object(compose, "capture", capture)):
            return compose.Deployment(self.options)

    def test_repairs_the_incident_by_adding_relay_to_an_existing_two_file_deployment(self):
        self.current["Config"]["Labels"][compose.COMPOSE_FILES_LABEL] = ",".join(
            str(self.root / name) for name in ["compose.yml", "compose.override.yml"]
        )
        deployment = self.make_deployment()
        self.assertEqual(deployment.files[-1], self.root / "compose.desktop-relay.yml")
        self.assertEqual(len(deployment.required), 3)
        self.assertEqual(len(self.commands), 1)

    def test_first_relay_deployment_uses_resolved_environment_and_renders_again(self):
        self.current = {}
        deployment = self.make_deployment()
        self.assertIn(self.root / "compose.desktop-relay.yml", deployment.files)
        self.assertEqual(len(self.commands), 2)

    def test_disabled_relay_does_not_add_or_start_turn(self):
        self.current, self.config = {}, configuration(False)
        deployment = self.make_deployment()
        self.assertNotIn(self.root / "compose.desktop-relay.yml", deployment.files)
        self.assertFalse(deployment.required)

    def test_recorded_optional_files_and_override_order_are_preserved(self):
        names = ["compose.yml", "compose.desktop-relay.yml", "extra.yml", "compose.override.yml"]
        self.current["Config"]["Labels"][compose.COMPOSE_FILES_LABEL] = ",".join(str(self.root / n) for n in names)
        deployment = self.make_deployment()
        self.assertEqual(deployment.files, [self.root / name for name in names])

    def test_missing_recorded_file_aborts_before_render_or_update(self):
        self.current["Config"]["Labels"][compose.COMPOSE_FILES_LABEL] = ",".join(
            str(self.root / name) for name in ["compose.yml", "missing-private.yml"]
        )
        with self.assertRaisesRegex(DeploymentError, "recorded Compose file"):
            self.make_deployment()
        self.assertEqual(self.commands, [])

    def test_a_later_override_removing_ports_blocks_up(self):
        self.config["services"]["admin-go"]["ports"] = []
        self.options.action = "up"
        with patch.object(compose.subprocess, "run") as update:
            with self.assertRaisesRegex(DeploymentError, "mappings are missing"):
                self.make_deployment().update()
            update.assert_not_called()

    def test_update_targets_only_admin_go_without_build_pull_or_dependency_restart(self):
        deployment = self.make_deployment()
        deployment.options.force_recreate = True
        with patch.object(compose.subprocess, "run") as update, patch.object(deployment, "verify") as verify:
            update.return_value.returncode = 0
            deployment.update()
        self.assertEqual(update.call_args.args[0][-8:], [
            "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "admin-go"
        ])
        verify.assert_called_once()

    def test_explicit_turn_update_uses_the_same_complete_compose_file_list(self):
        deployment = self.make_deployment()
        deployment.options.update_turn = True
        with patch.object(compose.subprocess, "run") as update, patch.object(deployment, "verify") as verify:
            update.return_value.returncode = 0
            deployment.update()
        commands = [call.args[0] for call in update.call_args_list]
        self.assertEqual([command[-1] for command in commands], ["desktop-turn", "admin-go"])
        self.assertEqual(commands[0][:-1], commands[1][:-1])
        self.assertIn(str(self.root / "compose.desktop-relay.yml"), commands[0])
        verify.assert_called_once()

    def test_safe_summary_and_failed_inspection_never_print_credentials(self):
        summary = json.dumps(self.make_deployment().summary())
        self.assertNotIn(RELAY_ENV["DESKTOP_TURN_SECRET"], summary)
        output = io.StringIO()
        with patch.object(compose.subprocess, "run") as command, contextlib.redirect_stderr(output):
            command.return_value.returncode = 1
            command.return_value.stderr = RELAY_ENV["DESKTOP_TURN_SECRET"]
            self.assertEqual(compose.main(["up"]), 1)
            self.assertEqual(command.call_count, 1)
        self.assertNotIn(RELAY_ENV["DESKTOP_TURN_SECRET"], output.getvalue())

    def test_failed_update_keeps_compose_output_private(self):
        deployment = self.make_deployment()
        with patch.object(compose.subprocess, "run") as update, patch.object(deployment, "verify") as verify:
            update.return_value.returncode = 1
            update.return_value.stderr = RELAY_ENV["DESKTOP_TURN_SECRET"]
            with self.assertRaisesRegex(DeploymentError, "admin-go update failed") as failure:
                deployment.update()
        self.assertTrue(update.call_args.kwargs["capture_output"])
        self.assertNotIn(RELAY_ENV["DESKTOP_TURN_SECRET"], str(failure.exception))
        verify.assert_not_called()


@unittest.skipUnless(os.environ.get("COMPOSE_CONFIG_TEST") == "1", "set COMPOSE_CONFIG_TEST=1 with Docker Compose")
class RealComposeTests(unittest.TestCase):
    def test_real_compose_merge_adds_ports_and_detects_a_later_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            for name in ["compose.yml", "compose.desktop-relay.yml"]:
                shutil.copy2(compose.ADMIN_ROOT / name, root / name)
            values = {**RELAY_ENV, "DESKTOP_TURN_PUBLIC_IP": "192.0.2.1"}
            (root / ".env").write_text("\n".join(f"{key}={value}" for key, value in values.items()), encoding="utf-8")
            options = compose.parse_options(["check", "--project-name", "deployment-guard-test"])
            options.root = root
            with patch.object(compose, "container_for", return_value={}):
                deployment = compose.Deployment(options)
                self.assertEqual(len(deployment.required), 3)
                override = root / "remove-ports.yml"
                override.write_text("services:\n  admin-go:\n    ports: !override []\n", encoding="utf-8")
                options.file = [root / "compose.desktop-relay.yml", override]
                with self.assertRaisesRegex(DeploymentError, "mappings are missing"):
                    compose.Deployment(options)


if __name__ == "__main__":
    unittest.main()
