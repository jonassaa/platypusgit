@echo off
rem The `pgit` CLI, as shipped by the platypusgit .msi (#144).
rem
rem %~dp0 is this file's own directory (with a trailing backslash), so the shim
rem is self-locating and no install path is baked into it. The release binary is
rem windows_subsystem = "windows", so cmd does not block on it, and
rem tauri-plugin-single-instance forwards the arguments into a running instance.
"%~dp0platypusgit.exe" %*
