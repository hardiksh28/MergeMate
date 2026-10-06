import { gh, type Repo } from "@/lib/github";
import { errorResponse } from "@/lib/groq";
import { getSession, oauthConfigured } from "@/lib/session";

// Opens a real PR from the user's fork. Requires the user's own GitHub token (classic: public_repo,
// or fine-grained with Contents + Pull requests write). The user approves every submission in the UI.
export async function POST(req: Request) {
  try {
    // signed-in GitHub session first, a pasted personal token as the fallback
    const session = oauthConfigured() ? await getSession() : null;
    const token = session?.token || req.headers.get("x-github-token") || "";
    if (!token) {
      return Response.json(
        { error: "Sign in with GitHub so MergeMate can open the PR from your account." },
        { status: 401 },
      );
    }
    const { repo, branch, issueNumber, title, body, draft, files, dco } = (await req.json()) as {
      dco?: boolean;
      repo: string;
      branch: string;
      issueNumber: number;
      title: string;
      body: string;
      draft: boolean;
      files: { path: string; content: string }[];
    };
    if (!files?.length) return Response.json({ error: "No changes to submit" }, { status: 400 });

    const me = await gh<{ login: string; id: number; name: string | null }>("/user", { token });
    // DCO projects reject commits without a Signed-off-by trailer matching the commit author.
    const identity = { name: me.name || me.login, email: `${me.id}+${me.login}@users.noreply.github.com` };
    const signOff = dco ? `\n\nSigned-off-by: ${identity.name} <${identity.email}>` : "";

    // 1. fork (idempotent: returns the existing fork if there is one)
    const fork = await gh<Repo>(`/repos/${repo}/forks`, { token, method: "POST", body: { default_branch_only: true } });
    const forkName = fork.full_name;

    // 2. wait for the fork to be ready, then sync it with upstream
    for (let i = 0; i < 10; i++) {
      try {
        await gh(`/repos/${forkName}/git/ref/heads/${encodeURIComponent(fork.default_branch)}`, { token });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    try {
      await gh(`/repos/${forkName}/merge-upstream`, { token, method: "POST", body: { branch: fork.default_branch } });
    } catch {}

    // 3. branch off upstream's head
    const upstreamRef = await gh<{ object: { sha: string } }>(
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      { token },
    );
    const newBranch = `mergemate/issue-${issueNumber}-${Date.now().toString(36).slice(-4)}`;
    await gh(`/repos/${forkName}/git/refs`, {
      token,
      method: "POST",
      body: { ref: `refs/heads/${newBranch}`, sha: upstreamRef.object.sha },
    });

    // 4. commit each changed file
    for (const f of files) {
      let sha: string | undefined;
      try {
        const existing = await gh<{ sha: string }>(
          `/repos/${forkName}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(newBranch)}`,
          { token },
        );
        sha = existing.sha;
      } catch {}
      await gh(`/repos/${forkName}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}`, {
        token,
        method: "PUT",
        body: {
          message: (files.length === 1 ? title : `${title} (${f.path})`) + signOff,
          ...(dco ? { author: identity, committer: identity } : {}),
          content: Buffer.from(f.content, "utf8").toString("base64"),
          branch: newBranch,
          ...(sha ? { sha } : {}),
        },
      });
    }

    // 5. open the PR upstream
    const pr = await gh<{ html_url: string; number: number }>(`/repos/${repo}/pulls`, {
      token,
      method: "POST",
      body: {
        title,
        body,
        head: `${me.login}:${newBranch}`,
        base: branch,
        draft: !!draft,
        maintainer_can_modify: true,
      },
    });
    return Response.json({ url: pr.html_url, number: pr.number, branch: newBranch, fork: forkName });
  } catch (e) {
    return errorResponse(e);
  }
}
