<#
.SYNOPSIS
    Install the `pgit` CLI for an already-installed platypusgit (Windows).

.DESCRIPTION
    For the Windows installs the .msi does not cover: a build from source, an
    unpacked/portable layout, or an .msi whose PATH change has not reached the
    shell you are in. The .msi already ships `pgit.cmd` in its install directory
    and puts that directory on the machine PATH — this script detects that and
    refuses to write a second one.

        irm https://platypusgit.com/install-pgit.ps1 | iex

    Writes a `pgit.cmd` shim into %LOCALAPPDATA%\PlatypusGit\bin (per user, no
    admin) and appends that directory to the current user's PATH.

    Windows has no symlink without elevation or Developer Mode, so the shim is a
    `.cmd`, not a link. The PATH append deliberately avoids two traps:

      * `setx` truncates at 1024 characters, and `setx PATH "%PATH%;..."` writes
        the MERGED machine+user PATH into the user PATH.
      * a bare [Environment]::SetEnvironmentVariable(..., 'User') rewrites a
        REG_EXPAND_SZ PATH as REG_SZ with %USERPROFILE% and friends EXPANDED,
        permanently. So the value is read unexpanded and written back with the
        registry kind it already had.

    Mirrors src-tauri/windows/add-user-path.ps1, which the app's own Settings
    screen runs. Issue: https://github.com/jonassaa/platypusgit/issues/144

.PARAMETER App
    The platypusgit.exe to point `pgit` at. Auto-detected when omitted.

.PARAMETER BinDir
    Where to write pgit.cmd. Defaults to %LOCALAPPDATA%\PlatypusGit\bin.

.PARAMETER DryRun
    Print what would happen and change nothing.
#>
[CmdletBinding()]
param(
    [string] $App = $env:PLATYPUSGIT_APP,
    [string] $BinDir = $env:PGIT_BIN_DIR,
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BinaryName = 'platypusgit'
$ExeName = "$BinaryName.exe"
$ShimName = 'pgit.cmd'
$MaxShimBytes = 4096

# ─── pure helpers (exercised by the repo's verification, off Windows) ─────────

function Get-ShimBody {
    # Matches cli.rs::shim_cmd_body. %* forwards every argument; the release
    # binary is windows_subsystem = "windows", so cmd does not block on it.
    param([Parameter(Mandatory = $true)] [string] $ExePath)
    return "@echo off`r`n`"$ExePath`" %*`r`n"
}

function Get-UpdatedPath {
    # The new PATH string, or $null when $Dir is already in it.
    param(
        [AllowEmptyString()] [AllowNull()] [string] $Current,
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

function Test-ReferencesApp {
    # The same probe cli.rs and install-pgit.sh use: a small wrapper naming our
    # binary. Windows has no symlink case worth handling here.
    param([Parameter(Mandatory = $true)] [string] $Path)

    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    } catch {
        return $false
    }
    if ($item.PSIsContainer -or $item.Length -gt $MaxShimBytes) { return $false }
    try {
        return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop) -match [regex]::Escape($BinaryName)
    } catch {
        return $false
    }
}

# ─── locate the app ──────────────────────────────────────────────────────────

function Find-App {
    $candidates = New-Object System.Collections.Generic.List[string]

    # The MSI records its install directory; DisplayName is matched rather than
    # a manufacturer key, which tauri derives from the bundle identifier.
    $uninstallRoots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($root in $uninstallRoots) {
        try {
            Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -like 'PlatypusGit*' -and $_.InstallLocation } |
                ForEach-Object { $candidates.Add((Join-Path $_.InstallLocation $ExeName)) }
        } catch { }
    }

    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($base) { $candidates.Add((Join-Path $base "PlatypusGit\$ExeName")) }
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }

    $onPath = Get-Command $ExeName -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

if ([string]::IsNullOrWhiteSpace($App)) { $App = Find-App }
if ([string]::IsNullOrWhiteSpace($App)) {
    throw "Cannot find $ExeName — install PlatypusGit first, or pass -App <path>."
}
if (-not (Test-Path -LiteralPath $App -PathType Leaf)) { throw "$App does not exist." }
$App = (Resolve-Path -LiteralPath $App).Path

# ─── is a `pgit` already here? ───────────────────────────────────────────────

$existing = Get-Command 'pgit' -ErrorAction SilentlyContinue
if ($existing -and (Test-ReferencesApp $existing.Source)) {
    Write-Host "pgit is already installed at $($existing.Source) — nothing to do."
    Write-Host "It runs: $App"
    return
}
if ($existing) {
    Write-Warning "A different 'pgit' is already on your PATH at $($existing.Source)."
    Write-Warning 'It will not be touched; ours goes in its own directory below.'
}

# ─── write the shim ──────────────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($BinDir)) {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set — pass -BinDir <path>.' }
    $BinDir = Join-Path $env:LOCALAPPDATA 'PlatypusGit\bin'
}

$shimPath = Join-Path $BinDir $ShimName
$body = Get-ShimBody -ExePath $App

if ($DryRun) {
    Write-Host "would write: $shimPath"
    Write-Host "would run:   $App"
    Write-Host "would add to your user PATH: $BinDir"
    return
}

New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
# No BOM: cmd.exe treats a UTF-8 BOM as part of the first command.
[System.IO.File]::WriteAllText($shimPath, $body, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Installed: $shimPath -> $App"

# ─── put it on the user's PATH ───────────────────────────────────────────────

function Send-EnvironmentChange {
    $signature = @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
    try {
        $native = Add-Type -MemberDefinition $signature -Name 'PgitInstallNative' -Namespace 'PlatypusGit' -PassThru
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
    if ($null -eq $key) { throw 'Cannot open HKCU\Environment for writing.' }
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

try {
    $outcome = Add-UserPathEntry -Dir $BinDir
    if ($outcome -eq 'added') {
        Send-EnvironmentChange
        Write-Host "Added $BinDir to your user PATH. Open a new terminal, then: pgit --help"
    } else {
        Write-Host "$BinDir is already on your user PATH. Run: pgit --help"
    }
} catch {
    # The shim exists either way — a failed PATH write is not a failed install.
    Write-Warning "Could not update your PATH: $_"
    Write-Warning "Add this directory to your PATH yourself: $BinDir"
}
