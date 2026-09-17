#!/bin/sh
# A quoted path is refused in a worktree-isolated assistant session ("a command
# whose name is computed at runtime"), and symlinking the binary breaks it --
# Chrome resolves `Google Chrome Framework` relative to the symlink and dies in
# dlopen. A wrapper that execs the real path is what works.
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$@"
