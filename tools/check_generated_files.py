"""Check the staged files in CI or a Git tree before creating a worktree."""

import argparse
import os
import subprocess
from pathlib import PurePosixPath

OUTPUT_DIRECTORIES = {
    "node_modules", ".next", ".wrangler", ".pnpm-store", ".turbo", ".vitest",
    "out", "dist", "build", "coverage", "playwright-report", "test-results", "__pycache__",
}
OUTPUT_SUFFIXES = (".tsbuildinfo", ".pyc", ".xcresult")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source", choices=["index"])
    source.add_argument("--worktree-preflight", metavar="REF")
    args = parser.parse_args()
    command = (["git", "ls-files", "--cached", "-z"] if args.source else
               ["git", "ls-tree", "-r", "--name-only", "-z", "--end-of-options",
                args.worktree_preflight])
    paths = os.fsdecode(subprocess.check_output(command)).split("\0")
    blocked = [p for p in paths if p and any(
        part in OUTPUT_DIRECTORIES or part.endswith(OUTPUT_SUFFIXES)
        for part in PurePosixPath(p).parts
    )]
    if blocked:
        raise SystemExit("Generated files found in Git:\n" + "\n".join(blocked))


if __name__ == "__main__":
    main()
