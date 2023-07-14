import { type SpawnOptionsWithoutStdio, spawn } from "node:child_process";

export function runCommand(command: string, args: string[], opts?: SpawnOptionsWithoutStdio) {
    const process = spawn(command, args, opts);
    const promise = new Promise<string | undefined>((resolve) => {
        // Is this allowed?
        let buffer = "";

        // Git blame is counting lines beginning from 1. `editor.selection.active.line` is counting from 0.
        process.stdout.on("data", data => {
            buffer += data;
        });
        process.stderr.on("data", data => {
            // console.log("stderr.Data:", data.toString("utf-8"));
            // TODO: Show "error"-notification ?
        });

        process.on("close", (code) => {
            if (buffer.length > 0) {
                resolve(buffer);
            } else {
                resolve(undefined);
            }
        });
    });

    return { process, promise };
}
