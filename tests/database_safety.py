from ipaddress import ip_address
from urllib.parse import unquote, urlsplit


def validate_test_database_url(url: str) -> None:
    parsed = urlsplit(url)
    host = parsed.hostname
    database = unquote(parsed.path.lstrip("/").split("/", 1)[0]).lower()
    try:
        local_host = host == "localhost" or (host is not None and ip_address(host).is_loopback)
    except ValueError:
        local_host = False

    if not local_host or "test" not in database:
        raise ValueError(
            "Tests require a loopback Postgres host and a database name containing 'test'; "
            "production and remote databases are not allowed."
        )
