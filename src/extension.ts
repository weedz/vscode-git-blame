import * as vscode from "vscode";

import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname } from "node:path";
import { formatTimeAgo } from "./time";
import { runCommand } from "./run-command";

interface BlameCommitter {
    name: string;
    email: string;
    time: number;
}

interface BlameStruct {
    author: BlameCommitter;
    committer: BlameCommitter;
    summary: string;
    sha: string;
}

type ActionableMessageItem = {
    action: string;
} & vscode.MessageItem;

let showInlineHints = false;

export function activate(context: vscode.ExtensionContext) {
    const inlineHintDecorator = vscode.window.createTextEditorDecorationType({});

    async function showBlame() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const blame = await getBlame(editor);
        if (blame instanceof Error) {
            return vscode.window.showErrorMessage(`Failed to blame: ${blame.message}`);
        }

        const actions: ActionableMessageItem[] = [
            {
                title: "Open online",
                action: "open-online"
            },
            {
                title: "Copy SHA to clipboard",
                action: "copy-to-clipboard"
            },
        ];

        const result = await vscode.window.showInformationMessage(`Blame ${blame.committer.name} (${formatTimeAgo(new Date(blame.committer.time * 1000))}):\n${blame.summary}\n${blame.sha}`,  ...actions);
        if (!result) {
            return;
        }
        if (result.action === "copy-to-clipboard") {
            vscode.env.clipboard.writeText(blame.sha);
        }
        if (result.action === "open-online") {
            const cwd = dirname(editor.document.uri.path);

            // git rev-parse --abbrev-ref --symbolic-full-name @{u}
            const remoteBranchResult = await runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd }).promise;
            if (!remoteBranchResult) {
                return vscode.window.showWarningMessage("No tracking branch");
            }

            const remote = remoteBranchResult.substring(0, remoteBranchResult.indexOf("/"));

            // git ls-remote --get-url [remote]
            let remoteUrlResult = await runCommand("git", ["ls-remote", "--get-url", remote], { cwd }).promise;
            if (!remoteUrlResult) {
                return vscode.window.showWarningMessage(`Could not find remote '${remote}'`);
            }

            if (remoteUrlResult.endsWith(".git")) {
                remoteUrlResult = remoteUrlResult.slice(0, -4);
            }

            // TODO: Probably won't work with "git" urls (`git@github.com:weedz/vscode-git-blame.git` or something similar)
            const url = `${remoteUrlResult}/commit/${blame.sha}`;
            vscode.commands.executeCommand("vscode.open", url);
        }
    }

    function toggleInlineHints() {
        showInlineHints = !showInlineHints;
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        if (!showInlineHints) {
            editor.setDecorations(inlineHintDecorator, []);
            return;
        }

        onSelectionChange(editor, inlineHintDecorator);
    }

    vscode.window.onDidChangeTextEditorSelection(e => onSelectionChange(e.textEditor, inlineHintDecorator));

    context.subscriptions.push(vscode.commands.registerCommand("extension.git-blame", showBlame));
    context.subscriptions.push(vscode.commands.registerCommand("extension.git-blame.toggle-inline-hints", toggleInlineHints));
}

async function onSelectionChange(editor: vscode.TextEditor, lineDecorator: vscode.TextEditorDecorationType) {
    if (!showInlineHints) {
        return;
    }

    editor.setDecorations(lineDecorator, []);

    const blame = await getBlame(editor);
    let contentText: string;
    if (blame instanceof Error) {
        contentText = blame.message;
    } else {
        const summary = blame.summary.length > 20 ? `${blame.summary.slice(0,18)}...` : blame.summary.slice(0,18);
        contentText = `${blame.committer.name} (${blame.sha.slice(0,8)}, ${formatTimeAgo(new Date(blame.committer.time * 1000))}) ${summary}`;
    }

    const decorationPosition = new vscode.Position(
        editor.selection.active.line,
        Number.MAX_SAFE_INTEGER,
    );


    editor.setDecorations(lineDecorator, [
        {
            renderOptions: {
                after: {
                    contentText,
                    margin: `0 0 0 ${3}rem`,
                    color: new vscode.ThemeColor("editorCodeLens.foreground"),
                },
            },
            range: new vscode.Range(decorationPosition, decorationPosition),
        },
    ]);
}

// TODO: Is it really necessary to handle this?
let activeBlame: ChildProcessWithoutNullStreams | null;
async function getBlame(editor: vscode.TextEditor): Promise<BlameStruct | Error> {

    if (!editor.document.uri.path.startsWith("/")) {
        return Error("Cannot blame non-existent file");
    }

    if (activeBlame) {
        activeBlame.kill("SIGKILL");
        activeBlame = null;
    }

    const line = editor.selection.active.line;
    const command = runCommand("git", ["blame", "-C", "--porcelain", "-L", `${line+1},+1`, editor.document.uri.path], {
        cwd: dirname(editor.document.uri.path),
    });
    activeBlame = command.process;

    const result = await command.promise;

    activeBlame = null;

    if (!result) {
        return Error("Unknown error..");
    }

    return parseBlame(result)
}

function parseBlame(blameString: string): BlameStruct | Error {
    // NOTE: Assumes the following structure (https://git-scm.com/docs/git-blame#_the_porcelain_format):
    // 0. [40-byte SHA-1] [some file stuff, not interesting]
    // 1. author [author_name]
    // 2. author-mail [<author_email>]
    // 3. author-time [authored_time]
    // 4. (SKIP) author-tz [author_tz]
    // 5. committer [committer_name]
    // 6. committer-mail [<committer_email>]
    // 7. committer-time [committer_time]
    // 8. (SKIP) committer-tz [committer_tz]
    // 9. summary [summary]

    const lines = blameString.split("\n");

    const sha = lines[0].substring(0, lines[0].indexOf(" "));
    if (sha === "0000000000000000000000000000000000000000") {
        // Not Committed Yet
        return Error("Change not committed yet");
    }

    const blame: BlameStruct = {
        author: {
            email: "",
            name: "",
            time: 0
        },
        committer: {
            email: "",
            name: "",
            time: 0
        },
        sha,
        summary: "",
    };


    blame.author.name = lines[1].substring(lines[1].indexOf(" ") + 1);
    blame.author.email = lines[2].substring(lines[2].indexOf(" ") + 1);
    blame.author.time = Number.parseInt(lines[3].substring(lines[3].indexOf(" ") + 1), 10);

    blame.committer.name = lines[5].substring(lines[5].indexOf(" ") + 1);
    blame.committer.email = lines[6].substring(lines[6].indexOf(" ") + 1);
    blame.committer.time = Number.parseInt(lines[7].substring(lines[7].indexOf(" ") + 1), 10);

    blame.summary = lines[9].substring(lines[9].indexOf(" ") + 1);

    return blame;
}
