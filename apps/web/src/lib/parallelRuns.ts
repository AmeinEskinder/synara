import type { NativeApi, OrchestrationThread, ThreadId } from "@synara/contracts";
import { archiveThreadFromClient } from "./threadArchive";

export function parallelAttemptSettled(thread: {
  latestTurn: { state: string } | null;
  session: { activeTurnId?: unknown; status: string } | null;
}): boolean {
  return (
    thread.latestTurn !== null &&
    thread.latestTurn.state !== "running" &&
    !thread.session?.activeTurnId &&
    thread.session?.status !== "starting" &&
    thread.session?.status !== "connecting" &&
    thread.session?.status !== "running"
  );
}

export function parallelComparisonPrompt(attempts: readonly OrchestrationThread[]): string {
  return [
    "Compare these independent attempts at the same task. Assess correctness, tradeoffs and changes against the common base. Recommend one attempt or explain how to combine their strengths. Do not merge branches or change files unless I ask.",
    `Task: ${attempts[0]?.messages.find((message) => message.role === "user")?.text.slice(0, 16_000) ?? ""}`,
    ...attempts.map((thread) => {
      const answer =
        thread.messages.findLast((message) => message.role === "assistant")?.text ??
        "No final answer recorded.";
      const excerpt = answer.slice(0, 16_000);
      return `Attempt ${(thread.parallelRun?.index ?? 0) + 1}\nModel: ${thread.modelSelection.provider}/${thread.modelSelection.model}\nBase: ${thread.parallelRun?.baseCommit}\nBranch: ${thread.branch}\nWorktree: ${thread.worktreePath}\nFinal answer:\n${excerpt}${answer.length > excerpt.length ? "\n[Answer excerpt; inspect the original attempt for the rest.]" : ""}`;
    }),
  ].join("\n\n---\n\n");
}

/** Archive losing conversations; existing explicit worktree removal retains its
 * dirty-file checks and confirmation. Never silently delete a losing branch. */
export async function selectParallelRunAttempt(
  api: NativeApi,
  runId: string,
  winner: ThreadId,
): Promise<void> {
  const snapshot = await api.orchestration.getShellSnapshot();
  const attempts = snapshot.threads.filter((thread) => thread.parallelRun?.runId === runId);
  if (
    attempts.length !== attempts[0]?.parallelRun?.count ||
    !attempts.some((thread) => thread.id === winner && !thread.archivedAt) ||
    attempts.some((thread) => !parallelAttemptSettled(thread))
  )
    throw new Error("Wait for all attempts to finish or stop them before selecting one.");
  for (const thread of attempts) {
    if (thread.id !== winner && !thread.archivedAt)
      await archiveThreadFromClient(api.orchestration, thread.id);
  }
}
