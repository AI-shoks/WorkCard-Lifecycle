from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    ".git",
    ".local-packages",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
}
CREDENTIAL_FILENAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".netrc",
    "credentials.json",
    "id_ed25519",
    "id_rsa",
    "service-account.json",
}
# This fixture deliberately contains detector samples and is verified by unit tests.
ALLOWLISTED_FIXTURE_PATHS = {Path("tests/unit/test_secret_scan.py")}
PLACEHOLDER_MARKERS = {
    "replace_",
    "synthetic_",
    "test-only",
    "integration-signing",
    "openapi-only",
    "staging-only",
    "unused:unused",
}

PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{30,}\b"),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "generic password assignment": re.compile(
        r"(?i)\b(?:password|passwd|pwd)\b\s*[:=]\s*[\"']?"
        r"[A-Za-z0-9_!@#$%^&*+./-]{8,}[\"']?"
    ),
    "database URL credentials": re.compile(
        r"(?i)\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?)://"
        r"[^\s:/]+:[^\s@/]+@[^\s]+"
    ),
    "JWT-like token": re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    "Slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "Stripe secret token": re.compile(r"\bsk_live_[A-Za-z0-9]{16,}\b"),
    "Azure storage key": re.compile(r"\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}\b"),
}


def is_documented_placeholder(line: str) -> bool:
    lowered = line.lower()
    return any(marker in lowered for marker in PLACEHOLDER_MARKERS)


def scan(root: Path = ROOT) -> list[str]:
    findings: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file() or EXCLUDED_PARTS.intersection(path.parts):
            continue
        relative = path.relative_to(root)
        if relative in ALLOWLISTED_FIXTURE_PATHS:
            continue
        if path.name in CREDENTIAL_FILENAMES:
            findings.append(f"{relative}: credential file")
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for line_number, line in enumerate(content.splitlines(), start=1):
            if is_documented_placeholder(line):
                continue
            for label, pattern in PATTERNS.items():
                if pattern.search(line):
                    if label == "generic password assignment" and re.search(
                        r"(?i)\b(?:password|passwd|pwd)\b\s*=\s*"
                        r"(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*\(",
                        line,
                    ):
                        continue
                    findings.append(f"{relative}:{line_number}: {label}")
    return findings


def main() -> None:
    findings = scan()
    if findings:
        raise SystemExit("potential secrets found:\n" + "\n".join(findings))


if __name__ == "__main__":
    main()
