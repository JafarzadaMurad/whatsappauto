# Interactive multi-remote push helper.
# Run as: .\push.ps1
#
# Lists configured push remotes, asks which one to push to (or "both"),
# then runs `git push <remote> <branch>`. The current branch is used by
# default; pass an argument to override (e.g.  .\push.ps1 main ).

param(
    [string]$Branch = ""
)

$ErrorActionPreference = 'Stop'

# Resolve branch
if (-not $Branch) {
    $Branch = (git rev-parse --abbrev-ref HEAD).Trim()
}

# Build a unique list of push remotes with their URLs
$remoteLines = git remote -v | Where-Object { $_ -match '\(push\)$' }
$remotes = @()
foreach ($line in $remoteLines) {
    if ($line -match '^(\S+)\s+(\S+)\s+\(push\)$') {
        $remotes += [PSCustomObject]@{
            Name = $Matches[1]
            Url  = $Matches[2]
        }
    }
}

if ($remotes.Count -eq 0) {
    Write-Host "No push remotes configured." -ForegroundColor Red
    exit 1
}

# Print menu
Write-Host ""
Write-Host "Push '$Branch' to which remote?" -ForegroundColor Cyan
for ($i = 0; $i -lt $remotes.Count; $i++) {
    $r = $remotes[$i]
    # Mask any embedded credentials in the URL when displaying
    $safeUrl = $r.Url -replace '://[^@]+@', '://***@'
    Write-Host ("  [{0}] {1,-8}  {2}" -f ($i + 1), $r.Name, $safeUrl)
}
Write-Host ("  [a] all (push to every remote)") -ForegroundColor DarkGray
Write-Host ("  [q] quit") -ForegroundColor DarkGray
Write-Host ""

$choice = Read-Host "Choice"
$choice = $choice.Trim().ToLower()

if ($choice -eq 'q' -or $choice -eq '') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# Resolve selection -> list of remote names
$targets = @()
if ($choice -eq 'a' -or $choice -eq 'all') {
    $targets = $remotes | ForEach-Object { $_.Name }
} elseif ($choice -match '^\d+$') {
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge $remotes.Count) {
        Write-Host "Invalid choice." -ForegroundColor Red
        exit 1
    }
    $targets = @($remotes[$idx].Name)
} else {
    # Allow typing a remote name directly
    $match = $remotes | Where-Object { $_.Name -eq $choice } | Select-Object -First 1
    if (-not $match) {
        Write-Host "No remote named '$choice'." -ForegroundColor Red
        exit 1
    }
    $targets = @($match.Name)
}

# Push to each chosen remote
$failed = @()
foreach ($t in $targets) {
    Write-Host ""
    Write-Host "→ git push $t $Branch" -ForegroundColor Green
    git push $t $Branch
    if ($LASTEXITCODE -ne 0) {
        $failed += $t
    }
}

Write-Host ""
if ($failed.Count -gt 0) {
    Write-Host ("Failed: " + ($failed -join ', ')) -ForegroundColor Red
    exit 1
} else {
    Write-Host "Done." -ForegroundColor Green
}
