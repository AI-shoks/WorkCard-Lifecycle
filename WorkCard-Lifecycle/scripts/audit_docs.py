#!/usr/bin/env python3
"""Read-only structural auditor for governed Markdown/Obsidian documentation."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

ALLOWED_STATUSES = {
    "planned",
    "draft",
    "in-review",
    "accepted",
    "superseded",
    "rejected",
    "archived",
    "active",
}
REQUIRED_FIELDS = ("artifact_id", "status", "version", "owner", "updated")
ARTIFACT_ID_RE = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$")
WIKI_LINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    path: str
    message: str


@dataclass
class Document:
    path: Path
    relative_path: str
    metadata: dict[str, Any]
    text: str

    @property
    def artifact_id(self) -> str:
        return str(self.metadata.get("artifact_id", "")).strip()

    @property
    def status(self) -> str:
        return str(self.metadata.get("status", "")).strip()

    @property
    def aliases(self) -> list[str]:
        value = self.metadata.get("aliases", [])
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if value:
            return [str(value).strip()]
        return []


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def parse_frontmatter(text: str) -> tuple[dict[str, Any], bool]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, False

    end = next((index for index in range(1, len(lines)) if lines[index].strip() == "---"), None)
    if end is None:
        return {}, False

    metadata: dict[str, Any] = {}
    current_list: str | None = None
    for raw_line in lines[1:end]:
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        if current_list and re.match(r"^\s+-\s+", raw_line):
            metadata[current_list].append(_unquote(re.sub(r"^\s+-\s+", "", raw_line)))
            continue
        current_list = None
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", raw_line)
        if not match:
            continue
        key, raw_value = match.groups()
        value = raw_value.strip()
        if not value:
            metadata[key] = []
            current_list = key
        elif value.startswith("[") and value.endswith("]"):
            items = value[1:-1].strip()
            metadata[key] = [] if not items else [_unquote(item) for item in items.split(",")]
        elif value.lower() in {"null", "~"}:
            metadata[key] = None
        else:
            metadata[key] = _unquote(value)
    return metadata, True


def collect_documents(
    root: Path, docs_dir: str = "docs", includes: Iterable[str] = ()
) -> list[Document]:
    paths: set[Path] = set()
    governed_root = root / docs_dir
    if governed_root.is_dir():
        paths.update(path.resolve() for path in governed_root.rglob("*.md"))
    elif root.name == docs_dir and root.is_dir():
        paths.update(path.resolve() for path in root.rglob("*.md"))

    default_home = root / "00 Home.md"
    if default_home.is_file():
        paths.add(default_home.resolve())
    for include in includes:
        candidate = root / include
        if candidate.is_file() and candidate.suffix.lower() == ".md":
            paths.add(candidate.resolve())

    documents: list[Document] = []
    for path in sorted(paths, key=lambda item: str(item).lower()):
        text = path.read_text(encoding="utf-8-sig")
        metadata, _ = parse_frontmatter(text)
        try:
            relative = path.relative_to(root.resolve()).as_posix()
        except ValueError:
            relative = str(path)
        documents.append(Document(path, relative, metadata, text))
    return documents


def _add_lookup(lookup: dict[str, list[Document]], key: str, document: Document) -> None:
    normalized = key.strip().replace("\\", "/")
    if not normalized:
        return
    lookup.setdefault(normalized.casefold(), []).append(document)


def build_lookup(documents: list[Document]) -> dict[str, list[Document]]:
    lookup: dict[str, list[Document]] = {}
    for document in documents:
        _add_lookup(lookup, document.artifact_id, document)
        _add_lookup(lookup, document.path.stem, document)
        without_suffix = str(Path(document.relative_path).with_suffix("")).replace("\\", "/")
        _add_lookup(lookup, without_suffix, document)
        for alias in document.aliases:
            _add_lookup(lookup, alias, document)
    return lookup


def normalize_reference(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return normalize_reference(value[0]) if value else ""
    target = str(value).strip()
    wiki = WIKI_LINK_RE.fullmatch(target)
    if wiki:
        target = wiki.group(1)
    target = target.split("|", 1)[0].split("#", 1)[0].strip()
    if target.lower().endswith(".md"):
        target = target[:-3]
    return target.replace("\\", "/")


def resolve_reference(value: Any, lookup: dict[str, list[Document]]) -> list[Document]:
    target = normalize_reference(value)
    if not target:
        return []
    matches = lookup.get(target.casefold(), [])
    if not matches:
        matches = lookup.get(Path(target).name.casefold(), [])
    unique: list[Document] = []
    seen: set[Path] = set()
    for document in matches:
        if document.path not in seen:
            unique.append(document)
            seen.add(document.path)
    return unique


def content_for_link_audit(text: str) -> str:
    """Remove frontmatter and fenced examples so sample links are not treated as live."""
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        end = next((index for index in range(1, len(lines)) if lines[index].strip() == "---"), None)
        if end is not None:
            text = "\n".join(lines[end + 1 :])
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


def audit_project(
    root: Path, docs_dir: str = "docs", includes: Iterable[str] = ()
) -> dict[str, Any]:
    root = root.resolve()
    documents = collect_documents(root, docs_dir, includes)
    findings: list[Finding] = []

    def add(severity: str, code: str, document: Document | None, message: str) -> None:
        findings.append(
            Finding(severity, code, document.relative_path if document else ".", message)
        )

    if not documents:
        add("error", "DOCS_NOT_FOUND", None, f"No Markdown documents found under {docs_dir!r}.")

    frontmatter_presence: dict[Path, bool] = {}
    for document in documents:
        _, present = parse_frontmatter(document.text)
        frontmatter_presence[document.path] = present
        if not present:
            add(
                "error",
                "FRONTMATTER_MISSING",
                document,
                "YAML frontmatter is missing or not closed.",
            )
            continue
        for field in REQUIRED_FIELDS:
            value = document.metadata.get(field)
            if value is None or value == "" or value == []:
                add(
                    "error",
                    "META_MISSING",
                    document,
                    f"Required metadata field {field!r} is missing.",
                )

        artifact_id = document.artifact_id
        if artifact_id and not ARTIFACT_ID_RE.fullmatch(artifact_id):
            add("error", "ARTIFACT_ID_INVALID", document, f"Invalid artifact_id {artifact_id!r}.")

        status = document.status
        if status and status not in ALLOWED_STATUSES:
            add("error", "STATUS_INVALID", document, f"Unsupported status {status!r}.")

        raw_version = document.metadata.get("version")
        version: int | None = None
        try:
            version = int(str(raw_version))
            if version < 0:
                raise ValueError
        except (TypeError, ValueError):
            if raw_version not in (None, "", []):
                add("error", "VERSION_INVALID", document, "Version must be a non-negative integer.")
        if version is not None:
            if status == "planned" and version != 0:
                add(
                    "warning",
                    "VERSION_STATUS_MISMATCH",
                    document,
                    "Planned artifacts should use version 0.",
                )
            if status in {"accepted", "active"} and version < 1:
                add(
                    "error",
                    "VERSION_STATUS_MISMATCH",
                    document,
                    f"{status} artifacts must use a positive version.",
                )

        raw_updated = document.metadata.get("updated")
        if raw_updated not in (None, "", []):
            try:
                date.fromisoformat(str(raw_updated))
            except ValueError:
                add("error", "UPDATED_INVALID", document, "Updated must use YYYY-MM-DD format.")

        if status == "superseded" and not document.metadata.get("superseded_by"):
            add(
                "error",
                "SUPERSEDED_WITHOUT_TARGET",
                document,
                "Superseded document must identify its replacement.",
            )

    by_id: dict[str, list[Document]] = {}
    for document in documents:
        if document.artifact_id:
            by_id.setdefault(document.artifact_id.casefold(), []).append(document)
    for artifact_id, matches in by_id.items():
        if len(matches) > 1:
            paths = ", ".join(doc.relative_path for doc in matches)
            add(
                "error",
                "ARTIFACT_ID_DUPLICATE",
                matches[0],
                f"artifact_id {artifact_id!r} is used by: {paths}.",
            )

    lookup = build_lookup(documents)

    for document in documents:
        if not frontmatter_presence.get(document.path):
            continue
        for field, reciprocal_field in (
            ("supersedes", "superseded_by"),
            ("superseded_by", "supersedes"),
        ):
            raw_target = document.metadata.get(field)
            if not raw_target:
                continue
            targets = resolve_reference(raw_target, lookup)
            if not targets:
                add(
                    "error",
                    "SUPERSESSION_TARGET_MISSING",
                    document,
                    f"{field} target {raw_target!r} cannot be resolved.",
                )
                continue
            if len(targets) > 1:
                add(
                    "error",
                    "LINK_AMBIGUOUS",
                    document,
                    f"{field} target {raw_target!r} resolves to multiple documents.",
                )
                continue
            target = targets[0]
            if field == "supersedes" and target.status != "superseded":
                add(
                    "error",
                    "SUPERSESSION_STATUS_MISMATCH",
                    target,
                    f"Document superseded by {document.relative_path} "
                    "must use status 'superseded'.",
                )
            reciprocal_targets = resolve_reference(target.metadata.get(reciprocal_field), lookup)
            if len(reciprocal_targets) != 1 or reciprocal_targets[0].path != document.path:
                add(
                    "error",
                    "SUPERSESSION_NOT_RECIPROCAL",
                    document,
                    f"{field} relation with {target.relative_path} is not reciprocal.",
                )

        for match in WIKI_LINK_RE.finditer(content_for_link_audit(document.text)):
            raw = match.group(1)
            target = raw.split("|", 1)[0].split("#", 1)[0].strip()
            if not target:
                continue
            resolved = resolve_reference(target, lookup)
            if len(resolved) > 1:
                add(
                    "error",
                    "LINK_AMBIGUOUS",
                    document,
                    f"Obsidian link [[{raw}]] resolves to multiple documents.",
                )
            elif not resolved:
                candidate_values = [target, f"{target}.md" if not Path(target).suffix else target]
                exists = any(
                    (root / candidate).exists() or (document.path.parent / candidate).exists()
                    for candidate in candidate_values
                )
                if not exists:
                    add(
                        "error",
                        "LINK_BROKEN",
                        document,
                        f"Obsidian link [[{raw}]] cannot be resolved.",
                    )

    findings.sort(key=lambda item: (item.severity != "error", item.code, item.path, item.message))
    errors = sum(item.severity == "error" for item in findings)
    warnings = sum(item.severity == "warning" for item in findings)
    return {
        "root": str(root),
        "summary": {"documents": len(documents), "errors": errors, "warnings": warnings},
        "findings": [asdict(item) for item in findings],
    }


def format_text(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        f"Project docs audit: {report['root']}",
        f"Documents: {summary['documents']} | Errors: {summary['errors']} | "
        f"Warnings: {summary['warnings']}",
    ]
    if not report["findings"]:
        lines.append("PASS: no structural documentation issues found.")
    else:
        for finding in report["findings"]:
            lines.append(
                f"{finding['severity'].upper()} [{finding['code']}] "
                f"{finding['path']}: {finding['message']}"
            )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path.cwd(), help="Project root containing docs/."
    )
    parser.add_argument(
        "--docs-dir", default="docs", help="Governed documentation directory relative to root."
    )
    parser.add_argument(
        "--include",
        action="append",
        default=[],
        help="Additional Markdown file relative to root; repeatable.",
    )
    parser.add_argument("--format", choices=("text", "json"), default="text", dest="output_format")
    parser.add_argument("--fail-on-warning", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = audit_project(args.root, args.docs_dir, args.include)
    if args.output_format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_text(report))
    summary = report["summary"]
    return 1 if summary["errors"] or (args.fail_on_warning and summary["warnings"]) else 0


if __name__ == "__main__":
    sys.exit(main())
