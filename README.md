# Lash

Lash is a local-first collaborative writing editor. Open a draft, write and format,
then use **Documents** to find it again. **Share** lets a signed-in writer move a
draft to their account and invite an editor or reviewer. The status beside the title tells
you where the document is saved.

## Run the editor

Use Node 22 and pnpm 8.10.0.

```sh
pnpm install --frozen-lockfile
pnpm --filter @lash/web dev
```

Open [the local editor](http://localhost:3000). Writing, local history and
Markdown transfer work in a single browser profile.

## Try collaboration with two writers

With Docker Engine 28+ and Compose running locally, start the collaborative stack
from the repository root. Use a free port 3000 for the editor.

```sh
make dev-collab
```

Open [Lash](http://127.0.0.1:3000) in two separate browser profiles. In the first,
write a document and use **Share** to save it to an account. Use a disposable
address such as `writer@example.test`. Open its sign-in link from
[the local inbox](http://127.0.0.1:55324) in that same browser profile.

Create a **Can edit** invitation for `reviewer@example.test` and copy the link.
Open it in the second profile and sign in there using its own message from the
local inbox. Both writers can now edit the same document. Reload both tabs to
check the saved result.

For a review, invite a different account with **Can comment**. Highlight a
passage, choose **Comment** beside it, write a note, and select **Post comment**.
The other person can read and reply in **Discussion**. To send just the passage
and note to an individual, choose **Open email draft** and address it in your
mail app. Reviewers can also suggest new wording for an editor to accept.

Ctrl-C stops the app and Worker. Local account and room data survive a restart.

## Verify a change

```sh
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run test:e2e
```

For repeated account and collaboration checks, use the account and named-edit
Playwright configurations against a running local stack. The development server
and production browser test builds use the same checkout. Stop the server before
building. See the [contributor guide](AGENTS.md) and [deployment guide](DEPLOYMENT.md).
