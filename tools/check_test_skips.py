"""Flag new skipped tests on a PR, unless the PR explains the exception."""

import os
import re
import subprocess


def main():
    reasons = re.findall(r"\[allow-skip:([^\]]*)\]", os.environ.get("PR_BODY", ""))
    if any(reason.strip() for reason in reasons):
        return
    revisions = f"{os.environ['BASE_SHA']}...{os.environ['HEAD_SHA']}"
    diff = subprocess.check_output(
        ["git", "diff", "--no-ext-diff", "--no-color", "--unified=0", revisions, "--",
         "*.spec.ts", "*.spec.tsx", "*.test.ts", "*.test.tsx"],
        text=True,
    )
    skips = [
        line for line in diff.splitlines()
        if line.startswith("+") and not line.startswith("+++ ")
        and re.search(r"\b(?:(?:test|it|describe)\.skip|(?:test|it)\.todo)\b", line)
    ]
    if skips:
        raise SystemExit("Explain new skipped tests with [allow-skip: reason] in the PR.\n"
                         + "\n".join(skips))


if __name__ == "__main__":
    main()
