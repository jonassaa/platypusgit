# Append one directory to the CURRENT USER's persistent PATH (#144).
#
# Run by `cli::add_user_path` (fed on stdin, so nothing here is ever quoted into
# an argv) and mirrored by `scripts/install-pgit.ps1`. Prints `added`,
# `already-present`, or throws.
#
# The directory arrives in $env:PGIT_BIN_DIR, never as an argument: a path is
# user-controlled text and -Command takes a *script*, so an argument would be an
# injection vector. Same rule the credential code follows, here for injection
# rather than secrecy.
#
# Why not `setx`: it truncates at 1024 characters, and `setx PATH "%PATH%;..."`
# writes the MERGED machine+user PATH into the user PATH. It is the most common
# way to destroy a Windows PATH.
#
# Why not [Environment]::SetEnvironmentVariable(..., 'User') on its own: when
# HKCU\Environment\Path is REG_EXPAND_SZ containing %USERPROFILE%, .NET writes
# it back as REG_SZ with the variables EXPANDED, permanently. So the value is
# read unexpanded and written back with the kind it already had.

$ErrorActionPreference = 'Stop'

function Get-UpdatedPath {
    # Pure: the new PATH string, or $null when $Dir is already in it. Split out
    # so it can be exercised without a registry (see the repo's verification
    # notes — it is the only half of this file testable off Windows).
    param(
        [AllowEmptyString()] [string] $Current,
        [Parameter(Mandatory = $true)] [string] $Dir
    )

    $needle = $Dir.Trim().Trim('"').TrimEnd('\', '/')
    if ([string]::IsNullOrWhiteSpace($needle)) { throw 'Refusing to add an empty PATH entry' }

    $parts = @()
    if (-not [string]::IsNullOrEmpty($Current)) { $parts = @($Current -split ';') }

    foreach ($part in $parts) {
        if ($part.Trim().Trim('"').TrimEnd('\', '/') -ieq $needle) { return $null }
    }

    $kept = @($parts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    return (@($kept) + $needle) -join ';'
}

function Send-EnvironmentChange {
    # Tell already-running processes (Explorer, and therefore every shell it
    # launches from now on) to re-read the environment. Best effort: without it
    # the change is real but invisible until the next sign-in.
    $signature = @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
    try {
        $native = Add-Type -MemberDefinition $signature -Name 'PgitEnvNative' -Namespace 'PlatypusGit' -PassThru
        $unused = [UIntPtr]::Zero
        # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 5s.
        [void] $native::SendMessageTimeout([IntPtr] 0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref] $unused)
    } catch {
        Write-Verbose "PATH broadcast failed: $_"
    }
}

function Add-UserPathEntry {
    param([Parameter(Mandatory = $true)] [string] $Dir)

    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if ($null -eq $key) { throw 'Cannot open HKCU\Environment for writing' }
    try {
        $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        try { $kind = $key.GetValueKind('Path') } catch { }

        $current = [string] $key.GetValue(
            'Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)

        $updated = Get-UpdatedPath -Current $current -Dir $Dir
        if ($null -eq $updated) { return 'already-present' }

        $key.SetValue('Path', $updated, $kind)
        return 'added'
    } finally {
        $key.Dispose()
    }
}

# `. add-user-path.ps1` with no PGIT_BIN_DIR set loads the functions and does
# nothing, which is how the pure half is tested.
if (-not [string]::IsNullOrWhiteSpace($env:PGIT_BIN_DIR)) {
    $outcome = Add-UserPathEntry -Dir $env:PGIT_BIN_DIR
    if ($outcome -eq 'added') { Send-EnvironmentChange }
    Write-Output $outcome
}
