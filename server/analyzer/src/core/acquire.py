import os
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from git import Repo, GitCommandError


@dataclass
class AcquireResult:
    root_path: Path
    mode: str
    source_ref: str
    run_id: str


def _inject_token_into_url(url: str, token: str) -> str:
    m = re.match(r"https://([^/]+)/(.*)", url)
    if m:
        return f"https://x-access-token:{token}@{m.group(1)}/{m.group(2)}"
    return url


def _hostname_is_github_com_family(host: str) -> bool:
    h = (host or "").lower()
    if h.startswith("www."):
        h = h[4:]
    return h == "github.com" or h.endswith(".github.com")


def acquire_target(
    target: Optional[str],
    replit_mode: bool,
    output_dir: Path,
) -> AcquireResult:
    run_id = uuid.uuid4().hex[:12]

    if replit_mode:
        root = Path(os.getcwd())
        if not root.exists():
            raise FileNotFoundError(f"Workspace directory not found: {root}")
        return AcquireResult(
            root_path=root,
            mode="replit",
            source_ref=str(root),
            run_id=run_id,
        )

    if target and (
        target.startswith("http://")
        or target.startswith("https://")
        or target.startswith("git@")
    ):
        repo_dir = output_dir / "repo"
        if repo_dir.exists():
            shutil.rmtree(repo_dir)

        clone_url = target
        gh_token = os.environ.get("GITHUB_TOKEN", "")
        if gh_token and target:
            try:
                parsed = urlparse(target)
                if parsed.hostname and _hostname_is_github_com_family(parsed.hostname):
                    clone_url = _inject_token_into_url(target, gh_token)
            except Exception:
                pass

        try:
            Repo.clone_from(clone_url, repo_dir)
        except GitCommandError as e:
            stderr_msg = str(e)
            if "Authentication failed" in stderr_msg or "Invalid username" in stderr_msg:
                raise RuntimeError(
                    f"Git clone failed: authentication error for {target}. "
                    "If this is a private repository, set the GITHUB_TOKEN secret "
                    "to a GitHub personal access token with 'repo' scope."
                ) from e
            raise

        return AcquireResult(
            root_path=repo_dir,
            mode="github",
            source_ref=target,
            run_id=run_id,
        )

    if target and os.path.isdir(target):
        return AcquireResult(
            root_path=Path(os.path.abspath(target)),
            mode="local",
            source_ref=os.path.abspath(target),
            run_id=run_id,
        )

    raise ValueError(
        "Provide a GitHub URL, a local directory path, or use --replit"
    )
