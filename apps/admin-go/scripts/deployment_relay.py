"""Validate the public TURN listeners without exposing resolved credentials."""

import ipaddress
from urllib.parse import parse_qs, urlsplit


ADMIN_SERVICE = "admin-go"
TURN_SERVICE = "desktop-turn"
TURN_URLS = "DESKTOP_TURN_URLS"
PRIVATE_TURN_PORT = 3478
PRIVATE_CONTROL_PORT = 5766


class DeploymentError(RuntimeError):
    """A deployment cannot preserve the configured service safely."""


def environment(container):
    return dict(item.split("=", 1) for item in container.get("Config", {}).get("Env", []) if "=" in item)


def relay_enabled(values):
    return bool(str(values.get(TURN_URLS) or "").strip())


def listener_port(value):
    try:
        parsed = urlsplit("//" + str(value))
        if parsed.port and not ipaddress.ip_address(parsed.hostname).is_loopback:
            return parsed.port
    except ValueError:
        pass
    raise DeploymentError("TURN must listen on a reachable container interface.")


def required_ports(values):
    """Match each advertised transport to its internal listener and public port."""
    required = set()
    for address in str(values.get(TURN_URLS) or "").split(","):
        if not address.strip():
            continue
        parsed = urlsplit(address.strip())
        endpoint = urlsplit("//" + parsed.path)
        protocol = parse_qs(parsed.query).get("transport", ["udp"])[0]
        variable = "DESKTOP_TURN_LISTEN"
        if parsed.scheme == "turns":
            protocol, variable = "tcp", "DESKTOP_TURN_TLS_LISTEN"
        if parsed.scheme not in {"turn", "turns"} or protocol not in {"udp", "tcp"} or not endpoint.port:
            raise DeploymentError("TURN URLs must specify supported transports and explicit ports.")
        required.add((listener_port(values.get(variable, "")), protocol, endpoint.port))
    return required


def reachable_binding(address):
    if not address:
        return True
    try:
        return not ipaddress.ip_address(address).is_loopback
    except ValueError:
        return False


def configured_ports(service):
    return {
        (int(port["target"]), port.get("protocol", "tcp"), int(port["published"]))
        for port in service.get("ports", [])
        if str(port.get("published", "")).isdigit() and reachable_binding(port.get("host_ip"))
    }


def published_ports(container):
    return {
        (int(target.split("/")[0]), target.split("/")[1], int(binding["HostPort"]))
        for target, bindings in container.get("NetworkSettings", {}).get("Ports", {}).items()
        for binding in bindings or []
        if reachable_binding(binding.get("HostIp"))
    }


def ensure_ports(required, actual):
    missing = required - actual
    if missing:
        ports = ", ".join(f"{public}/{protocol} -> {target}" for target, protocol, public in sorted(missing))
        raise DeploymentError("TURN port mappings are missing or loopback-only: " + ports)


def validate_configuration(config, previous):
    services = config["services"]
    admin = services[ADMIN_SERVICE]
    values = admin.get("environment", {})
    if relay_enabled(environment(previous)) and not relay_enabled(values):
        raise DeploymentError("The existing TURN relay would be disabled. Restore its deployment configuration.")
    if not relay_enabled(values):
        return set()
    required = required_ports(values)
    ensure_ports(required, configured_ports(admin))
    turn = services.get(TURN_SERVICE)
    if not turn or not set(admin.get("networks", {})) & set(turn.get("networks", {})):
        raise DeploymentError("The TURN backend and admin-go must share a Compose network.")
    if any(int(port["target"]) in {PRIVATE_TURN_PORT, PRIVATE_CONTROL_PORT} for port in turn.get("ports", [])):
        raise DeploymentError("The private TURN authentication listener must not be published.")
    validate_quota_control(values, turn.get("environment", {}))
    return required


def validate_quota_control(admin, turn):
    if not admin.get("DESKTOP_TURN_CONTROL"):
        return  # Compatible rollback configurations may not support runtime quotas.
    password = admin.get("DESKTOP_TURN_CONTROL_PASSWORD", "")
    if (admin["DESKTOP_TURN_CONTROL"] != "desktop-turn:5766" or len(password) < 32
            or password != turn.get("DESKTOP_TURN_CONTROL_PASSWORD")
            or password == turn.get("DESKTOP_TURN_SECRET")
            or not admin.get("DESKTOP_TURN_QUOTA_DIR")):
        raise DeploymentError("TURN quota control configuration is missing or inconsistent.")


def verify_runtime(config, containers):
    admin = containers.get(ADMIN_SERVICE, {})
    if not admin.get("State", {}).get("Running"):
        raise DeploymentError("admin-go is not running.")
    required = validate_configuration(config, admin)
    if not required:
        return
    if not relay_enabled(environment(admin)):
        raise DeploymentError("The running admin-go has not enabled the configured TURN relay.")
    if required_ports(environment(admin)) != required:
        raise DeploymentError("The running TURN listeners do not match the deployment configuration.")
    ensure_ports(required, published_ports(admin))
    turn = containers.get(TURN_SERVICE, {})
    if not turn.get("State", {}).get("Running"):
        raise DeploymentError("The TURN backend is not running.")
    desired_control = config["services"][ADMIN_SERVICE].get("environment", {}).get("DESKTOP_TURN_CONTROL")
    if desired_control:
        if environment(admin).get("DESKTOP_TURN_CONTROL") != desired_control:
            raise DeploymentError("Running admin-go has not enabled the configured TURN quota control.")
        validate_quota_control(environment(admin), environment(turn))
    admin_networks = set(admin.get("NetworkSettings", {}).get("Networks", {}))
    turn_networks = set(turn.get("NetworkSettings", {}).get("Networks", {}))
    if not admin_networks & turn_networks:
        raise DeploymentError("The running TURN backend and admin-go do not share a network.")
    bindings = turn.get("NetworkSettings", {}).get("Ports", {})
    if any(value for key, value in bindings.items()
           if key.split("/")[0] in {str(PRIVATE_TURN_PORT), str(PRIVATE_CONTROL_PORT)}):
        raise DeploymentError("The running private TURN authentication listener must not be published.")
